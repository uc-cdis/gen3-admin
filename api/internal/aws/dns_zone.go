package aws

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
	"github.com/gin-gonic/gin"
)

// A CSOC needs a public hosted zone in its own account: Terraform validates
// the certificate through it and the install points the hostnames at the ALB.
// Most people do not have a spare domain, but do have one they can delegate
// a subdomain of, so the wizard can create the zone and, given access to the
// parent zone, add the NS records that delegate it.

// Delegation is where a zone's delegation from its parent stands.
type Delegation string

const (
	// DelegationOK: the parent has NS records naming this zone's servers.
	DelegationOK Delegation = "delegated"
	// DelegationAdded: they were just written.
	DelegationAdded Delegation = "added"
	// DelegationManual: the parent zone is not reachable with the given
	// credentials; the operator adds the records themselves.
	DelegationManual Delegation = "manual"
	// DelegationConflict: the parent already has other records at or under
	// the name, which a delegation would hide. Nothing was changed.
	DelegationConflict Delegation = "conflict"
)

// zoneAPI is the part of the Route53 client the zone setup uses.
type zoneAPI interface {
	ListHostedZonesByName(context.Context, *route53.ListHostedZonesByNameInput, ...func(*route53.Options)) (*route53.ListHostedZonesByNameOutput, error)
	GetHostedZone(context.Context, *route53.GetHostedZoneInput, ...func(*route53.Options)) (*route53.GetHostedZoneOutput, error)
	CreateHostedZone(context.Context, *route53.CreateHostedZoneInput, ...func(*route53.Options)) (*route53.CreateHostedZoneOutput, error)
	ChangeTagsForResource(context.Context, *route53.ChangeTagsForResourceInput, ...func(*route53.Options)) (*route53.ChangeTagsForResourceOutput, error)
	ListResourceRecordSets(context.Context, *route53.ListResourceRecordSetsInput, ...func(*route53.Options)) (*route53.ListResourceRecordSetsOutput, error)
	ChangeResourceRecordSets(context.Context, *route53.ChangeResourceRecordSetsInput, ...func(*route53.Options)) (*route53.ChangeResourceRecordSetsOutput, error)
}

type ZoneResult struct {
	ZoneID      string   `json:"hosted_zone_id"`
	ZoneName    string   `json:"zone_name"`
	Created     bool     `json:"created"`
	NameServers []string `json:"name_servers"`

	ParentZoneID   string     `json:"parent_zone_id,omitempty"`
	ParentZoneName string     `json:"parent_zone_name,omitempty"`
	Delegation     Delegation `json:"delegation"`
	// Conflicts are the parent's records a delegation would hide.
	Conflicts []string `json:"conflicts,omitempty"`
	// Resolves is whether public DNS already answers with the zone's servers.
	Resolves bool `json:"resolves"`
}

// findPublicZone returns the public zone named exactly name, or nil.
func findPublicZone(ctx context.Context, client zoneAPI, name string) (*r53types.HostedZone, error) {
	fqdn := name + "."
	out, err := client.ListHostedZonesByName(ctx, &route53.ListHostedZonesByNameInput{
		DNSName: awssdk.String(fqdn), MaxItems: awssdk.Int32(10),
	})
	if err != nil {
		return nil, err
	}
	for i, z := range out.HostedZones {
		if awssdk.ToString(z.Name) == fqdn && (z.Config == nil || !z.Config.PrivateZone) {
			return &out.HostedZones[i], nil
		}
	}
	return nil, nil
}

func zoneID(z *r53types.HostedZone) string {
	return strings.TrimPrefix(awssdk.ToString(z.Id), "/hostedzone/")
}

// ensureZone finds or creates the public zone for name, and returns its
// name servers.
func ensureZone(ctx context.Context, client zoneAPI, name string) (id string, servers []string, created bool, err error) {
	z, err := findPublicZone(ctx, client, name)
	if err != nil {
		return "", nil, false, err
	}
	if z != nil {
		out, err := client.GetHostedZone(ctx, &route53.GetHostedZoneInput{Id: z.Id})
		if err != nil {
			return "", nil, false, err
		}
		if out.DelegationSet == nil {
			return "", nil, false, fmt.Errorf("zone %s has no name servers", name)
		}
		return zoneID(z), normalizeServers(out.DelegationSet.NameServers), false, nil
	}
	out, err := client.CreateHostedZone(ctx, &route53.CreateHostedZoneInput{
		Name:            awssdk.String(name),
		CallerReference: awssdk.String(fmt.Sprintf("gen3-csoc-%d", time.Now().UnixNano())),
		HostedZoneConfig: &r53types.HostedZoneConfig{
			Comment: awssdk.String("CSOC hostnames; created by the gen3-csoc bootstrap"),
		},
	})
	if err != nil {
		return "", nil, false, err
	}
	id = zoneID(out.HostedZone)
	// Tagging is a convenience for finding it later; the zone works without.
	_, _ = client.ChangeTagsForResource(ctx, &route53.ChangeTagsForResourceInput{
		ResourceId: awssdk.String(id), ResourceType: r53types.TagResourceTypeHostedzone,
		AddTags: []r53types.Tag{{Key: awssdk.String("ManagedBy"), Value: awssdk.String("gen3-csoc")}},
	})
	return id, normalizeServers(out.DelegationSet.NameServers), true, nil
}

// findParentZone walks up from name's parent to the closest public zone.
func findParentZone(ctx context.Context, client zoneAPI, name string) (*r53types.HostedZone, error) {
	labels := strings.Split(name, ".")
	for i := 1; i < len(labels)-1; i++ {
		z, err := findPublicZone(ctx, client, strings.Join(labels[i:], "."))
		if err != nil || z != nil {
			return z, err
		}
	}
	return nil, nil
}

// delegate adds NS records for name, pointing at servers, to the parent zone.
// It changes nothing if the parent already has other records at or under the
// name: delegating would hide them, and they belong to something else.
func delegate(ctx context.Context, client zoneAPI, parentID, name string, servers []string) (Delegation, []string, error) {
	fqdn := name + "."
	// Route53 lists records in order of their reversed labels, so everything
	// at or under the name comes in one run starting at the name.
	out, err := client.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
		HostedZoneId: awssdk.String(parentID), StartRecordName: awssdk.String(fqdn), MaxItems: awssdk.Int32(100),
	})
	if err != nil {
		return "", nil, err
	}
	var existing []string
	var conflicts []string
	for _, rr := range out.ResourceRecordSets {
		n := awssdk.ToString(rr.Name)
		if n != fqdn && !strings.HasSuffix(n, "."+fqdn) {
			break
		}
		if n == fqdn && rr.Type == r53types.RRTypeNs {
			for _, r := range rr.ResourceRecords {
				existing = append(existing, awssdk.ToString(r.Value))
			}
			continue
		}
		conflicts = append(conflicts, fmt.Sprintf("%s %s", strings.TrimSuffix(n, "."), rr.Type))
	}
	if len(conflicts) > 0 {
		return DelegationConflict, conflicts, nil
	}
	if sameServers(existing, servers) {
		return DelegationOK, nil, nil
	}
	if len(existing) > 0 {
		// NS records for a different zone: someone else's delegation.
		return DelegationConflict, []string{name + " NS " + strings.Join(normalizeServers(existing), ",")}, nil
	}
	records := make([]r53types.ResourceRecord, 0, len(servers))
	for _, s := range servers {
		records = append(records, r53types.ResourceRecord{Value: awssdk.String(s + ".")})
	}
	_, err = client.ChangeResourceRecordSets(ctx, &route53.ChangeResourceRecordSetsInput{
		HostedZoneId: awssdk.String(parentID),
		ChangeBatch: &r53types.ChangeBatch{
			Comment: awssdk.String("Delegate " + name + " to its CSOC hosted zone"),
			Changes: []r53types.Change{{
				// CREATE, not UPSERT: if a record appeared since the check,
				// fail instead of replacing it.
				Action: r53types.ChangeActionCreate,
				ResourceRecordSet: &r53types.ResourceRecordSet{
					Name: awssdk.String(fqdn), Type: r53types.RRTypeNs, TTL: awssdk.Int64(300), ResourceRecords: records,
				},
			}},
		},
	})
	if err != nil {
		return "", nil, err
	}
	return DelegationAdded, nil, nil
}

func normalizeServers(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		out = append(out, strings.TrimSuffix(strings.ToLower(strings.TrimSpace(s)), "."))
	}
	sort.Strings(out)
	return out
}

func sameServers(a, b []string) bool {
	a, b = normalizeServers(a), normalizeServers(b)
	if len(a) == 0 || len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// lookupNS asks a public resolver, not the local one: what matters is whether
// ACM and the operator's browser will find the zone.
var lookupNS = func(ctx context.Context, name string) ([]string, error) {
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, "1.1.1.1:53")
		},
	}
	ns, err := r.LookupNS(ctx, name)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(ns))
	for _, n := range ns {
		out = append(out, n.Host)
	}
	return out, nil
}

func publiclyDelegated(ctx context.Context, name string, servers []string) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	got, err := lookupNS(ctx, name)
	return err == nil && sameServers(got, servers)
}

// HostedZoneSetupHandler finds or creates the public zone for a domain in the
// CSOC's account and delegates it from its parent zone. The parent may be in
// another account: Parent is the identity that can reach it, and when it is
// absent or the parent zone is not found the result says which NS records to
// add by hand.
// POST /api/aws/route53/setup  {domain, profile | credentials, parent: {profile | credentials}}
func HostedZoneSetupHandler(c *gin.Context) {
	var req struct {
		Target
		Domain string  `json:"domain"`
		Parent *Target `json:"parent,omitempty"`
	}
	if !bindTarget(c, &req) {
		return
	}
	domain := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(req.Domain)), ".")
	if !validDomain.MatchString(domain) || strings.Count(domain, ".") < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the zone must be a subdomain, such as csoc.example.org"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var parent zoneAPI
	if req.Parent != nil {
		pcfg, err := loadConfig(ctx, *req.Parent)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "parent zone credentials: " + err.Error()})
			return
		}
		parent = route53.NewFromConfig(pcfg)
	}
	res, err := setupZone(ctx, route53.NewFromConfig(cfg), parent, domain)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": awsErrorMessage(err)})
		return
	}
	c.JSON(http.StatusOK, res)
}

func setupZone(ctx context.Context, client, parent zoneAPI, domain string) (*ZoneResult, error) {
	id, servers, created, err := ensureZone(ctx, client, domain)
	if err != nil {
		return nil, fmt.Errorf("hosted zone %s: %w", domain, err)
	}
	res := &ZoneResult{ZoneID: id, ZoneName: domain, Created: created, NameServers: servers, Delegation: DelegationManual}
	if parent != nil {
		pz, err := findParentZone(ctx, parent, domain)
		if err != nil {
			return nil, fmt.Errorf("parent zone of %s: %w", domain, err)
		}
		if pz != nil && zoneID(pz) != id {
			res.ParentZoneID, res.ParentZoneName = zoneID(pz), strings.TrimSuffix(awssdk.ToString(pz.Name), ".")
			res.Delegation, res.Conflicts, err = delegate(ctx, parent, res.ParentZoneID, domain, servers)
			if err != nil {
				return nil, fmt.Errorf("delegate %s from %s: %w", domain, res.ParentZoneName, err)
			}
		}
	}
	res.Resolves = publiclyDelegated(ctx, domain, servers)
	return res, nil
}
