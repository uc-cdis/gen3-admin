package aws

import (
	"context"
	"strings"
	"testing"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
)

func TestShortenNegativeTTL(t *testing.T) {
	zones := newFake()
	zones.addZone("workshop.example.org", "ZWS")
	zones.addRecord("ZWS", "workshop.example.org", r53types.RRTypeSoa,
		"ns-1.awsdns-01.org. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400")

	changed, err := shortenNegativeTTL(context.Background(), zones, "ZWS", "workshop.example.org")
	if err != nil || !changed {
		t.Fatalf("changed = %v, %v", changed, err)
	}
	last := zones.changes[len(zones.changes)-1]
	if got := awssdk.ToString(last.ResourceRecordSet.ResourceRecords[0].Value); !strings.HasSuffix(got, " 1209600 60") {
		t.Errorf("SOA = %q", got)
	}
	// The fake keeps both versions; only the new one is under 60 now.
	zones.records["ZWS"] = []r53types.ResourceRecordSet{*last.ResourceRecordSet}
	if changed, _ := shortenNegativeTTL(context.Background(), zones, "ZWS", "workshop.example.org"); changed {
		t.Error("an SOA already at 60 was changed again")
	}
}
