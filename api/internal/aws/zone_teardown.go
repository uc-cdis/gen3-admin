package aws

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
	"github.com/gin-gonic/gin"
)

// Removing a CSOC's zone is the last step back to a blank account, after
// the environment is destroyed. Only a zone the bootstrap created, tagged
// ManagedBy=gen3-csoc, is ever deleted, and its records other than its own
// SOA and NS are deleted only when asked: they may belong to something
// still running, such as a commons' certificate validation.

type zoneTeardownAPI interface {
	zoneAPI
	ListTagsForResource(context.Context, *route53.ListTagsForResourceInput, ...func(*route53.Options)) (*route53.ListTagsForResourceOutput, error)
	DeleteHostedZone(context.Context, *route53.DeleteHostedZoneInput, ...func(*route53.Options)) (*route53.DeleteHostedZoneOutput, error)
}

type ZoneTeardownResult struct {
	ZoneID string `json:"hosted_zone_id,omitempty"`
	// Deleted is false when there was no such zone, or when Remaining
	// records stopped the delete.
	Deleted bool `json:"deleted"`
	// Remaining are records other than the zone's own, listed when the
	// caller did not ask for them to go.
	Remaining []string `json:"remaining,omitempty"`
	// Delegation is "removed", "none" (the parent had no matching NS
	// records) or "manual" (no parent zone was reachable, so any NS
	// records for the zone are the operator's to remove).
	Delegation string `json:"delegation"`
	ParentZone string `json:"parent_zone,omitempty"`
}

var errNotOurZone = errors.New("the zone was not created by the CSOC bootstrap (no ManagedBy=gen3-csoc tag), so it is left alone")

func ownRecord(rr r53types.ResourceRecordSet, fqdn string) bool {
	return awssdk.ToString(rr.Name) == fqdn && (rr.Type == r53types.RRTypeSoa || rr.Type == r53types.RRTypeNs)
}

func listAllRecords(ctx context.Context, client zoneAPI, id string) ([]r53types.ResourceRecordSet, error) {
	in := &route53.ListResourceRecordSetsInput{HostedZoneId: awssdk.String(id)}
	var all []r53types.ResourceRecordSet
	for {
		out, err := client.ListResourceRecordSets(ctx, in)
		if err != nil {
			return nil, err
		}
		all = append(all, out.ResourceRecordSets...)
		if !out.IsTruncated {
			return all, nil
		}
		in.StartRecordName, in.StartRecordType, in.StartRecordIdentifier = out.NextRecordName, out.NextRecordType, out.NextRecordIdentifier
	}
}

func deleteRecords(ctx context.Context, client zoneAPI, id string, records []r53types.ResourceRecordSet) error {
	for i := 0; i < len(records); i += 100 {
		batch := records[i:min(i+100, len(records))]
		changes := make([]r53types.Change, 0, len(batch))
		for j := range batch {
			changes = append(changes, r53types.Change{Action: r53types.ChangeActionDelete, ResourceRecordSet: &batch[j]})
		}
		if _, err := client.ChangeResourceRecordSets(ctx, &route53.ChangeResourceRecordSetsInput{
			HostedZoneId: awssdk.String(id), ChangeBatch: &r53types.ChangeBatch{Changes: changes},
		}); err != nil {
			return err
		}
	}
	return nil
}

// teardownZone deletes the zone for domain, and its delegation from the
// parent zone when parent is given and the NS records there name exactly
// this zone's servers.
func teardownZone(ctx context.Context, client zoneTeardownAPI, parent zoneAPI, domain string, withRecords bool) (*ZoneTeardownResult, error) {
	res := &ZoneTeardownResult{Delegation: "manual"}
	fqdn := domain + "."
	z, err := findPublicZone(ctx, client, domain)
	if err != nil {
		return nil, err
	}
	var servers []string
	if z != nil {
		res.ZoneID = zoneID(z)
		tags, err := client.ListTagsForResource(ctx, &route53.ListTagsForResourceInput{
			ResourceId: awssdk.String(res.ZoneID), ResourceType: r53types.TagResourceTypeHostedzone,
		})
		if err != nil {
			return nil, err
		}
		ours := false
		if tags.ResourceTagSet != nil {
			for _, t := range tags.ResourceTagSet.Tags {
				ours = ours || (awssdk.ToString(t.Key) == "ManagedBy" && awssdk.ToString(t.Value) == "gen3-csoc")
			}
		}
		if !ours {
			return nil, errNotOurZone
		}
		hz, err := client.GetHostedZone(ctx, &route53.GetHostedZoneInput{Id: z.Id})
		if err != nil {
			return nil, err
		}
		if hz.DelegationSet != nil {
			servers = normalizeServers(hz.DelegationSet.NameServers)
		}
		all, err := listAllRecords(ctx, client, res.ZoneID)
		if err != nil {
			return nil, err
		}
		var extra []r53types.ResourceRecordSet
		for _, rr := range all {
			if !ownRecord(rr, fqdn) {
				extra = append(extra, rr)
				res.Remaining = append(res.Remaining, fmt.Sprintf("%s %s", strings.TrimSuffix(awssdk.ToString(rr.Name), "."), rr.Type))
			}
		}
		if len(extra) > 0 && !withRecords {
			return res, nil
		}
		if err := deleteRecords(ctx, client, res.ZoneID, extra); err != nil {
			return nil, fmt.Errorf("delete records in %s: %w", domain, err)
		}
		res.Remaining = nil
	}

	if parent != nil {
		pz, err := findParentZone(ctx, parent, domain)
		if err != nil {
			return nil, fmt.Errorf("parent zone of %s: %w", domain, err)
		}
		// No parent zone reachable with these credentials: the delegation
		// may well be in another account, so it is the operator's to remove,
		// not reported as absent.
		if pz != nil {
			res.Delegation = "none"
		}
		if pz != nil && (z == nil || zoneID(pz) != res.ZoneID) {
			res.ParentZone = strings.TrimSuffix(awssdk.ToString(pz.Name), ".")
			out, err := parent.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
				HostedZoneId: awssdk.String(zoneID(pz)), StartRecordName: awssdk.String(fqdn), StartRecordType: r53types.RRTypeNs, MaxItems: awssdk.Int32(1),
			})
			if err != nil {
				return nil, err
			}
			for _, rr := range out.ResourceRecordSets {
				if awssdk.ToString(rr.Name) != fqdn || rr.Type != r53types.RRTypeNs {
					continue
				}
				var values []string
				for _, r := range rr.ResourceRecords {
					values = append(values, awssdk.ToString(r.Value))
				}
				// Only a delegation to this zone: with the zone already
				// gone (servers nil), any NS records at the name are
				// someone else's and are left.
				if servers == nil || !sameServers(values, servers) {
					continue
				}
				if err := deleteRecords(ctx, parent, zoneID(pz), []r53types.ResourceRecordSet{rr}); err != nil {
					return nil, fmt.Errorf("remove the delegation from %s: %w", res.ParentZone, err)
				}
				res.Delegation = "removed"
			}
		}
	}

	if z != nil {
		if _, err := client.DeleteHostedZone(ctx, &route53.DeleteHostedZoneInput{Id: z.Id}); err != nil {
			return nil, fmt.Errorf("delete zone %s: %w", domain, err)
		}
		res.Deleted = true
	}
	return res, nil
}

// HostedZoneTeardownHandler deletes the CSOC's zone and its delegation.
// POST /api/aws/route53/teardown  {domain, confirm, delete_records, profile | credentials, parent: {profile | credentials}}
func HostedZoneTeardownHandler(c *gin.Context) {
	var req struct {
		Target
		Domain        string  `json:"domain"`
		Confirm       string  `json:"confirm"`
		DeleteRecords bool    `json:"delete_records"`
		Parent        *Target `json:"parent,omitempty"`
	}
	if !bindTarget(c, &req) {
		return
	}
	domain := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(req.Domain)), ".")
	if !validDomain.MatchString(domain) || strings.Count(domain, ".") < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the zone must be a subdomain, such as csoc.example.org"})
		return
	}
	if req.Confirm != domain {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type the zone name to confirm"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorBody(req.Profile, err))
		return
	}
	var parent zoneAPI
	if req.Parent != nil {
		pcfg, err := loadConfig(ctx, *req.Parent)
		if err != nil {
			c.JSON(http.StatusBadRequest, ErrorBody(req.Parent.Profile, err))
			return
		}
		parent = route53.NewFromConfig(pcfg)
	}
	res, err := teardownZone(ctx, route53.NewFromConfig(cfg), parent, domain, req.DeleteRecords)
	switch {
	case errors.Is(err, errNotOurZone):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case err != nil:
		c.JSON(http.StatusBadGateway, ErrorBody(req.Profile, err))
	case len(res.Remaining) > 0:
		c.JSON(http.StatusConflict, gin.H{"error": "the zone still has records", "remaining": res.Remaining})
	default:
		c.JSON(http.StatusOK, res)
	}
}
