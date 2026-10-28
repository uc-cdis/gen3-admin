package aws

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	acmtypes "github.com/aws/aws-sdk-go-v2/service/acm/types"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
)

func TestRequestPublicAsksForEveryNameWithDNSValidation(t *testing.T) {
	certs := newFakeACM()
	domains, err := normalizeDomains([]string{"Portal.Workshop.example.org.", "auth.workshop.example.org", "portal.workshop.example.org"})
	if err != nil {
		t.Fatal(err)
	}
	arn, err := requestPublic(context.Background(), certs, domains, acmtypes.KeyAlgorithmEcPrime256v1)
	if err != nil || arn == "" {
		t.Fatal(arn, err)
	}
	r := certs.requested[0]
	if awssdk.ToString(r.DomainName) != "portal.workshop.example.org" || len(r.SubjectAlternativeNames) != 1 ||
		r.SubjectAlternativeNames[0] != "auth.workshop.example.org" || r.ValidationMethod != acmtypes.ValidationMethodDns ||
		r.KeyAlgorithm != acmtypes.KeyAlgorithmEcPrime256v1 {
		t.Errorf("request = %+v", r)
	}
}

func TestWriteValidationRecordsGoesToEachNamesZone(t *testing.T) {
	certs := newFakeACM()
	arn, _ := requestPublic(context.Background(), certs, []string{"portal.workshop.example.org", "auth.workshop.example.org", "www.other.net"}, acmtypes.KeyAlgorithmRsa2048)
	certs.describes[arn] = 1 // the records are published
	d, err := describeCertificate(context.Background(), certs, arn)
	if err != nil || len(d.Domains) != 3 {
		t.Fatalf("describe = %+v, %v", d, err)
	}
	zones := newFake()
	zones.addZone("workshop.example.org", "ZWS")
	res, err := writeValidationRecords(context.Background(), d, zones)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Written) != 2 || res.Written[0].Zone != "workshop.example.org" || len(res.Missing) != 1 || res.Missing[0] != "www.other.net" {
		t.Errorf("records = %+v", res)
	}
	if len(zones.records["ZWS"]) != 2 {
		t.Errorf("zone records = %v", zones.records["ZWS"])
	}
}

func selfSigned(t *testing.T) (string, string) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "imported.example.org"},
		DNSNames: []string{"imported.example.org"}, NotBefore: time.Now(), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kb, _ := x509.MarshalPKCS8PrivateKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: kb}))
}

func TestCheckImport(t *testing.T) {
	cert, key := selfSigned(t)
	if err := checkImport(cert, key, cert); err != nil {
		t.Errorf("a good certificate was refused: %v", err)
	}
	for name, c := range map[string][3]string{
		"key as body":       {key, key, ""},
		"two certs in body": {cert + cert, key, ""},
		"cert as key":       {cert, cert, ""},
		"key in the chain":  {cert, key, key},
		"not PEM at all":    {"hello", key, ""},
	} {
		if err := checkImport(c[0], c[1], c[2]); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	certs := newFakeACM()
	arn, err := importCertificate(context.Background(), certs, cert, key, "")
	if err != nil || !strings.Contains(arn, "certificate/") {
		t.Errorf("import = %q, %v", arn, err)
	}
}

func TestListCertificatesPutsCoveringOnesFirst(t *testing.T) {
	certs := newFakeACM(
		acmtypes.CertificateSummary{CertificateArn: awssdk.String("a"), DomainName: awssdk.String("other.example.org"), Status: acmtypes.CertificateStatusIssued},
		acmtypes.CertificateSummary{CertificateArn: awssdk.String("b"), DomainName: awssdk.String("*.workshop.example.org"), Status: acmtypes.CertificateStatusIssued},
		acmtypes.CertificateSummary{CertificateArn: awssdk.String("c"), DomainName: awssdk.String("portal.workshop.example.org"), Status: acmtypes.CertificateStatusIssued},
	)
	list, err := listCertificates(context.Background(), certs, []string{"portal.workshop.example.org", "auth.workshop.example.org"})
	if err != nil || len(list) != 3 {
		t.Fatal(list, err)
	}
	if list[0].ARN != "b" || !list[0].Covers || list[1].Covers || list[2].Covers {
		t.Errorf("order = %+v", list)
	}
}

func TestEnsureValidationWritesWhatIsMissingAndChecks(t *testing.T) {
	prev := lookupCNAME
	public := map[string]string{}
	lookupCNAME = func(_ context.Context, name string) (string, error) {
		if v, ok := public[name]; ok {
			return v, nil
		}
		return "", context.DeadlineExceeded
	}
	t.Cleanup(func() { lookupCNAME = prev })

	certs := newFakeACM()
	arn, _ := requestPublic(context.Background(), certs, []string{"portal.workshop.example.org", "auth.workshop.example.org"}, acmtypes.KeyAlgorithmRsa2048)
	certs.describes[arn] = 1
	zones := newFake()
	zones.addZone("workshop.example.org", "ZWS")

	d, written, err := ensureValidation(context.Background(), certs, zones, arn, true)
	if err != nil {
		t.Fatal(err)
	}
	if written == nil || len(written.Written) != 2 || len(zones.records["ZWS"]) != 2 {
		t.Fatalf("written = %+v, zone = %v", written, zones.records["ZWS"])
	}
	for _, ds := range d.Domains {
		if ds.DNS == nil || !ds.DNS.InZone || ds.DNS.Public || ds.DNS.Zone != "workshop.example.org" {
			t.Errorf("%s check = %+v", ds.Domain, ds.DNS)
		}
	}
	// Called again: nothing more to write; public DNS now answers.
	public["_abc.portal.workshop.example.org."] = "_xyz.acm-validations.aws."
	d, written, err = ensureValidation(context.Background(), certs, zones, arn, true)
	if err != nil || written != nil || len(zones.changes) != 2 {
		t.Fatalf("second pass wrote again: %+v %v, %d changes", written, err, len(zones.changes))
	}
	if !d.Domains[0].DNS.Public {
		t.Errorf("public answer not seen: %+v", d.Domains[0].DNS)
	}
}

func TestDeleteCertificateTakesItsRecordsWithIt(t *testing.T) {
	prev := lookupCNAME
	lookupCNAME = func(context.Context, string) (string, error) { return "", context.DeadlineExceeded }
	t.Cleanup(func() { lookupCNAME = prev })

	certs := newFakeACM()
	arn, _ := requestPublic(context.Background(), certs, []string{"portal.workshop.example.org", "auth.workshop.example.org"}, acmtypes.KeyAlgorithmRsa2048)
	certs.describes[arn] = 1
	zones := newFake()
	zones.addZone("workshop.example.org", "ZWS")
	zones.addRecord("ZWS", "other.workshop.example.org", r53types.RRTypeCname, "elsewhere.example.org.")
	if _, _, err := ensureValidation(context.Background(), certs, zones, arn, true); err != nil {
		t.Fatal(err)
	}
	if _, err := deleteCertificate(context.Background(), certs, zones, arn); !errors.Is(err, errNotOurCertificate) {
		t.Fatalf("an untagged certificate was deleted: %v", err)
	}
	certs.tags = map[string][]acmtypes.Tag{arn: {{Key: awssdk.String("ManagedBy"), Value: awssdk.String("gen3-csoc")}}}
	n, err := deleteCertificate(context.Background(), certs, zones, arn)
	if err != nil || n != 2 || len(certs.deleted) != 1 {
		t.Fatalf("removed %d, deleted %v, err %v", n, certs.deleted, err)
	}
	if len(zones.records["ZWS"]) != 1 || awssdk.ToString(zones.records["ZWS"][0].Name) != "other.workshop.example.org." {
		t.Errorf("zone records left = %v", zones.records["ZWS"])
	}
}
