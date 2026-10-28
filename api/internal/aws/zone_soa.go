package aws

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
	"github.com/gin-gonic/gin"
)

// Route 53 gives a new zone an SOA "minimum" of a day. Resolvers cache a
// "no such name" answer for up to that long (RFC 2308 caps it at the SOA's
// own TTL, 15 minutes, but not every resolver does), so one look at the
// portal's name before its record exists left a campus resolver answering
// NXDOMAIN for it long after. The bootstrap's zones cache misses for a
// minute instead.
const negativeTTL = 60

// shortenNegativeTTL lowers the zone's SOA minimum to negativeTTL. It
// changes nothing when it is already that short.
func shortenNegativeTTL(ctx context.Context, client zoneAPI, zoneID, zoneName string) (bool, error) {
	fqdn := strings.TrimSuffix(zoneName, ".") + "."
	out, err := client.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
		HostedZoneId: awssdk.String(zoneID), StartRecordName: awssdk.String(fqdn),
		StartRecordType: r53types.RRTypeSoa, MaxItems: awssdk.Int32(1),
	})
	if err != nil {
		return false, err
	}
	for _, rr := range out.ResourceRecordSets {
		if rr.Type != r53types.RRTypeSoa || awssdk.ToString(rr.Name) != fqdn || len(rr.ResourceRecords) != 1 {
			continue
		}
		f := strings.Fields(awssdk.ToString(rr.ResourceRecords[0].Value))
		if len(f) != 7 {
			return false, fmt.Errorf("unexpected SOA %q", awssdk.ToString(rr.ResourceRecords[0].Value))
		}
		if min, err := strconv.Atoi(f[6]); err == nil && min <= negativeTTL {
			return false, nil
		}
		f[6] = strconv.Itoa(negativeTTL)
		soa := rr
		soa.ResourceRecords = []r53types.ResourceRecord{{Value: awssdk.String(strings.Join(f, " "))}}
		_, err := client.ChangeResourceRecordSets(ctx, &route53.ChangeResourceRecordSetsInput{
			HostedZoneId: awssdk.String(zoneID),
			ChangeBatch: &r53types.ChangeBatch{
				Comment: awssdk.String("Cache missing names for a minute, not a day"),
				Changes: []r53types.Change{{Action: r53types.ChangeActionUpsert, ResourceRecordSet: &soa}},
			},
		})
		return err == nil, err
	}
	return false, nil
}

// ensureShortNegativeTTL does it for a zone the bootstrap created, and
// leaves anyone else's zone alone.
func ensureShortNegativeTTL(ctx context.Context, client zoneTeardownAPI, zoneID, zoneName string) {
	tags, err := client.ListTagsForResource(ctx, &route53.ListTagsForResourceInput{
		ResourceId: awssdk.String(zoneID), ResourceType: r53types.TagResourceTypeHostedzone,
	})
	if err != nil || tags.ResourceTagSet == nil {
		return
	}
	for _, t := range tags.ResourceTagSet.Tags {
		if awssdk.ToString(t.Key) == "ManagedBy" && awssdk.ToString(t.Value) == "gen3-csoc" {
			_, _ = shortenNegativeTTL(ctx, client, zoneID, zoneName)
			return
		}
	}
}

// lookupHost asks a public resolver, as a browser elsewhere would. Replaced
// in tests.
var lookupHost = func(ctx context.Context, name string) ([]string, error) {
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, "1.1.1.1:53")
		},
	}
	return r.LookupHost(ctx, name)
}

// DNSResolvesHandler says which names public DNS answers for: the wizard
// shows the portal only once both its names do, so nobody looks one up
// early and leaves a resolver caching that it does not exist.
// POST /api/aws/dns/resolves  {names}
func DNSResolvesHandler(c *gin.Context) {
	var req struct {
		Names []string `json:"names"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Names) == 0 || len(req.Names) > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "names: 1 to 10 hostnames"})
		return
	}
	out := map[string]bool{}
	for _, n := range req.Names {
		n = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(n)), ".")
		if !validDomain.MatchString(n) {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("%q is not a hostname", n)})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
		addrs, err := lookupHost(ctx, n)
		cancel()
		out[n] = err == nil && len(addrs) > 0
	}
	c.JSON(http.StatusOK, gin.H{"resolves": out})
}
