package aws

import (
	"context"
	"testing"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/acm"
	acmtypes "github.com/aws/aws-sdk-go-v2/service/acm/types"
)

// fakeACM is one region's certificates. A requested one has its validation
// record from the second describe on, as ACM does after a few seconds.
type fakeACM struct {
	certs     []acmtypes.CertificateSummary
	describes map[string]int
	requested []acm.RequestCertificateInput
}

func (f *fakeACM) ListCertificates(_ context.Context, in *acm.ListCertificatesInput, _ ...func(*acm.Options)) (*acm.ListCertificatesOutput, error) {
	var out []acmtypes.CertificateSummary
	for _, c := range f.certs {
		for _, s := range in.CertificateStatuses {
			if c.Status == s {
				out = append(out, c)
			}
		}
	}
	return &acm.ListCertificatesOutput{CertificateSummaryList: out}, nil
}

func (f *fakeACM) DescribeCertificate(_ context.Context, in *acm.DescribeCertificateInput, _ ...func(*acm.Options)) (*acm.DescribeCertificateOutput, error) {
	arn := awssdk.ToString(in.CertificateArn)
	f.describes[arn]++
	for _, c := range f.certs {
		if awssdk.ToString(c.CertificateArn) != arn {
			continue
		}
		d := &acmtypes.CertificateDetail{CertificateArn: c.CertificateArn, DomainName: c.DomainName, Status: c.Status}
		if f.describes[arn] > 1 {
			d.DomainValidationOptions = []acmtypes.DomainValidation{{
				DomainName: c.DomainName,
				ResourceRecord: &acmtypes.ResourceRecord{
					Name: awssdk.String("_abc." + awssdk.ToString(c.DomainName) + "."), Type: acmtypes.RecordTypeCname,
					Value: awssdk.String("_xyz.acm-validations.aws."),
				},
			}}
		}
		return &acm.DescribeCertificateOutput{Certificate: d}, nil
	}
	return nil, &acmtypes.ResourceNotFoundException{}
}

func (f *fakeACM) RequestCertificate(_ context.Context, in *acm.RequestCertificateInput, _ ...func(*acm.Options)) (*acm.RequestCertificateOutput, error) {
	f.requested = append(f.requested, *in)
	arn := "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-00000000000" + string(rune('0'+len(f.requested)))
	f.certs = append(f.certs, acmtypes.CertificateSummary{
		CertificateArn: awssdk.String(arn), DomainName: in.DomainName, Status: acmtypes.CertificateStatusPendingValidation,
	})
	return &acm.RequestCertificateOutput{CertificateArn: awssdk.String(arn)}, nil
}

func newFakeACM(certs ...acmtypes.CertificateSummary) *fakeACM {
	return &fakeACM{certs: certs, describes: map[string]int{}}
}

func fastRecordPolling(t *testing.T) {
	t.Helper()
	prevWait, prevEvery := recordWait, recordEvery
	recordWait, recordEvery = time.Second, time.Millisecond
	t.Cleanup(func() { recordWait, recordEvery = prevWait, prevEvery })
}

func TestCovers(t *testing.T) {
	for _, c := range []struct {
		name, host string
		want       bool
	}{
		{"commons.example.org", "commons.example.org", true},
		{"*.example.org", "commons.example.org", true},
		{"*.example.org", "a.commons.example.org", false}, // a wildcard is one label deep
		{"*.example.org", "example.org", false},
		{"other.example.org", "commons.example.org", false},
	} {
		if got := covers(c.name, c.host); got != c.want {
			t.Errorf("covers(%q, %q) = %v", c.name, c.host, got)
		}
	}
}

func TestRequestCertificateRequestsAndValidates(t *testing.T) {
	fastRecordPolling(t)
	certs, zones := newFakeACM(), newFake()
	zones.addZone("workshop.example.org", "ZWORK")

	res, err := requestCertificate(context.Background(), certs, zones, "commons-a.workshop.example.org")
	if err != nil {
		t.Fatal(err)
	}
	if res.Reused || len(certs.requested) != 1 || res.Status != "PENDING_VALIDATION" {
		t.Fatalf("result = %+v, requests = %d", res, len(certs.requested))
	}
	r := certs.requested[0]
	if r.ValidationMethod != acmtypes.ValidationMethodDns || len(awssdk.ToString(r.IdempotencyToken)) != 32 {
		t.Errorf("request = %+v", r)
	}
	if res.ZoneID != "ZWORK" || len(zones.changes) != 1 ||
		awssdk.ToString(zones.changes[0].ResourceRecordSet.Name) != "_abc.commons-a.workshop.example.org." {
		t.Errorf("validation record not written to the zone: zone %q, changes %+v", res.ZoneID, zones.changes)
	}
}

func TestRequestCertificateReusesACoveringOne(t *testing.T) {
	fastRecordPolling(t)
	wild := "arn:aws:acm:us-east-1:123456789012:certificate/11111111-1111-1111-1111-111111111111"
	certs := newFakeACM(acmtypes.CertificateSummary{
		CertificateArn: awssdk.String(wild), DomainName: awssdk.String("*.workshop.example.org"), Status: acmtypes.CertificateStatusIssued,
	})
	zones := newFake()
	zones.addZone("workshop.example.org", "ZWORK")

	res, err := requestCertificate(context.Background(), certs, zones, "commons-b.workshop.example.org")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Reused || res.ARN != wild || res.Status != "ISSUED" || len(certs.requested) != 0 || len(zones.changes) != 0 {
		t.Errorf("an issued wildcard was not reused: %+v, requests %d, changes %d", res, len(certs.requested), len(zones.changes))
	}
}

func TestRequestCertificateWithoutAZoneReturnsTheRecords(t *testing.T) {
	fastRecordPolling(t)
	certs := newFakeACM()
	res, err := requestCertificate(context.Background(), certs, newFake(), "commons.elsewhere.org")
	if err != nil {
		t.Fatal(err)
	}
	if res.ZoneID != "" || len(res.Records) != 1 {
		t.Errorf("with no zone, the records must come back to add by hand: %+v", res)
	}
}

func TestIdempotencyTokenIsStablePerHost(t *testing.T) {
	if idempotencyToken("a.example.org") != idempotencyToken("a.example.org") ||
		idempotencyToken("a.example.org") == idempotencyToken("b.example.org") {
		t.Error("the token must be the same for a host and differ between hosts")
	}
}
