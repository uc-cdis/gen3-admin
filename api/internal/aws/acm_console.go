package aws

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/acm"
	acmtypes "github.com/aws/aws-sdk-go-v2/service/acm/types"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
	"github.com/gin-gonic/gin"
)

// The CSOC's own certificate, chosen after its infrastructure is up and
// before the install, the way the ACM console offers it: request a public
// certificate (DNS validation, records written to Route 53 on request or
// copied to wherever the domain is hosted), import one from another
// authority, or pick one the account already has. Terraform no longer
// makes it, so a zone that is gone or not yet delegated cannot fail an
// apply near its end.

type acmConsoleAPI interface {
	acmAPI
	ImportCertificate(context.Context, *acm.ImportCertificateInput, ...func(*acm.Options)) (*acm.ImportCertificateOutput, error)
}

// DomainStatus is one name on a certificate and the record that validates it.
type DomainStatus struct {
	Domain string            `json:"domain"`
	Status string            `json:"status"`
	Record *ValidationRecord `json:"record,omitempty"`
	DNS    *RecordCheck      `json:"dns,omitempty"`
}

// RecordCheck is where a validation record is, looked up rather than
// remembered: in the Route 53 zone that serves the name, and in public DNS,
// which is what ACM reads.
type RecordCheck struct {
	Zone   string `json:"zone,omitempty"`
	InZone bool   `json:"in_zone"`
	Public bool   `json:"public"`
}

// lookupCNAME asks a public resolver, as ACM would. Replaced in tests.
var lookupCNAME = func(ctx context.Context, name string) (string, error) {
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, "1.1.1.1:53")
		},
	}
	return r.LookupCNAME(ctx, name)
}

func sameName(a, b string) bool {
	return strings.TrimSuffix(strings.ToLower(a), ".") == strings.TrimSuffix(strings.ToLower(b), ".")
}

// checkValidationDNS fills in each record's DNS check.
func checkValidationDNS(ctx context.Context, d *CertificateDetail, zones zoneAPI) {
	for i := range d.Domains {
		ds := &d.Domains[i]
		if ds.Record == nil {
			continue
		}
		chk := &RecordCheck{}
		host := strings.TrimPrefix(ds.Domain, "*.")
		z, err := findPublicZone(ctx, zones, host)
		if err == nil && z == nil {
			z, _ = findParentZone(ctx, zones, host)
		}
		if z != nil {
			chk.Zone = strings.TrimSuffix(awssdk.ToString(z.Name), ".")
			out, err := zones.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
				HostedZoneId: awssdk.String(zoneID(z)), StartRecordName: awssdk.String(ds.Record.Name),
				StartRecordType: r53types.RRTypeCname, MaxItems: awssdk.Int32(1),
			})
			if err == nil {
				for _, rr := range out.ResourceRecordSets {
					if sameName(awssdk.ToString(rr.Name), ds.Record.Name) && rr.Type == r53types.RRTypeCname {
						for _, v := range rr.ResourceRecords {
							chk.InZone = chk.InZone || sameName(awssdk.ToString(v.Value), ds.Record.Value)
						}
					}
				}
			}
		}
		lctx, cancel := context.WithTimeout(ctx, 4*time.Second)
		if got, err := lookupCNAME(lctx, ds.Record.Name); err == nil {
			chk.Public = sameName(got, ds.Record.Value)
		}
		cancel()
		ds.DNS = chk
	}
}

// ensureValidation is the whole of DNS validation when the names are in
// Route 53 here: the records ACM has published are written where they are
// missing, and each is then checked. Safe to call over and over: the wizard
// does, until ACM issues the certificate.
func ensureValidation(ctx context.Context, certs acmAPI, zones zoneAPI, arn string, write bool) (*CertificateDetail, *RecordsResult, error) {
	d, err := describeCertificate(ctx, certs, arn)
	if err != nil {
		return nil, nil, err
	}
	var written *RecordsResult
	if d.Status == string(acmtypes.CertificateStatusPendingValidation) {
		checkValidationDNS(ctx, d, zones)
		missing := &CertificateDetail{DomainName: d.DomainName}
		for _, ds := range d.Domains {
			if ds.Record != nil && ds.DNS != nil && !ds.DNS.InZone && ds.DNS.Zone != "" {
				missing.Domains = append(missing.Domains, ds)
			}
		}
		if write && len(missing.Domains) > 0 {
			if written, err = writeValidationRecords(ctx, missing, zones); err != nil {
				return nil, nil, err
			}
			checkValidationDNS(ctx, d, zones)
		}
	}
	return d, written, nil
}

// POST /api/aws/acm/ensure-validation  {target..., arn}
func ACMEnsureValidationHandler(c *gin.Context) {
	var req struct {
		Target
		ARN string `json:"arn"`
		// Write is false when DNS is the operator's: then it only checks.
		Write bool `json:"write"`
	}
	if !bindTarget(c, &req) {
		return
	}
	if !validCertificateARN.MatchString(req.ARN) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not an ACM certificate ARN"})
		return
	}
	certs, zones, ctx, cancel, ok := acmClients(c, req.Target, 60*time.Second)
	if !ok {
		return
	}
	defer cancel()
	d, written, err := ensureValidation(ctx, certs, zones, req.ARN, req.Write)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"certificate": d, "written": written})
}

type CertificateDetail struct {
	ARN          string         `json:"arn"`
	Type         string         `json:"type"` // AMAZON_ISSUED, IMPORTED
	Status       string         `json:"status"`
	DomainName   string         `json:"domain_name"`
	Names        []string       `json:"names"`
	KeyAlgorithm string         `json:"key_algorithm,omitempty"`
	NotAfter     *time.Time     `json:"not_after,omitempty"`
	InUseBy      []string       `json:"in_use_by,omitempty"`
	Domains      []DomainStatus `json:"domains"`
	Reason       string         `json:"failure_reason,omitempty"`
}

// The key algorithms the console offers for a public certificate.
var keyAlgorithms = map[string]acmtypes.KeyAlgorithm{
	"RSA_2048":      acmtypes.KeyAlgorithmRsa2048,
	"EC_prime256v1": acmtypes.KeyAlgorithmEcPrime256v1,
	"EC_secp384r1":  acmtypes.KeyAlgorithmEcSecp384r1,
}

// Every key type a listing should include: by default ACM lists RSA-2048
// and RSA-1024 certificates only.
var listedKeyTypes = []acmtypes.KeyAlgorithm{
	acmtypes.KeyAlgorithmRsa1024, acmtypes.KeyAlgorithmRsa2048, acmtypes.KeyAlgorithmRsa3072, acmtypes.KeyAlgorithmRsa4096,
	acmtypes.KeyAlgorithmEcPrime256v1, acmtypes.KeyAlgorithmEcSecp384r1, acmtypes.KeyAlgorithmEcSecp521r1,
}

func normalizeDomains(in []string) ([]string, error) {
	seen := map[string]bool{}
	var out []string
	for _, d := range in {
		d = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(d)), ".")
		if d == "" || seen[d] {
			continue
		}
		bare := strings.TrimPrefix(d, "*.")
		if !validDomain.MatchString(bare) {
			return nil, fmt.Errorf("%q is not a domain name", d)
		}
		seen[d] = true
		out = append(out, d)
	}
	if len(out) == 0 {
		return nil, errors.New("at least one domain name is needed")
	}
	if len(out) > 10 {
		return nil, errors.New("at most 10 domain names")
	}
	return out, nil
}

func describeCertificate(ctx context.Context, certs acmAPI, arn string) (*CertificateDetail, error) {
	out, err := certs.DescribeCertificate(ctx, &acm.DescribeCertificateInput{CertificateArn: awssdk.String(arn)})
	if err != nil {
		return nil, err
	}
	c := out.Certificate
	d := &CertificateDetail{
		ARN: arn, Type: string(c.Type), Status: string(c.Status), DomainName: awssdk.ToString(c.DomainName),
		Names: c.SubjectAlternativeNames, KeyAlgorithm: string(c.KeyAlgorithm), NotAfter: c.NotAfter,
		InUseBy: c.InUseBy, Reason: string(c.FailureReason), Domains: []DomainStatus{},
	}
	if len(d.Names) == 0 {
		d.Names = []string{d.DomainName}
	}
	for _, o := range c.DomainValidationOptions {
		ds := DomainStatus{Domain: awssdk.ToString(o.DomainName), Status: string(o.ValidationStatus)}
		if o.ResourceRecord != nil {
			ds.Record = &ValidationRecord{Name: awssdk.ToString(o.ResourceRecord.Name), Type: string(o.ResourceRecord.Type), Value: awssdk.ToString(o.ResourceRecord.Value)}
		}
		d.Domains = append(d.Domains, ds)
	}
	return d, nil
}

// requestPublic requests a DNS-validated certificate for domains. The same
// names and key ask for the same certificate again within ACM's hour,
// rather than a second one.
func requestPublic(ctx context.Context, certs acmAPI, domains []string, alg acmtypes.KeyAlgorithm) (string, error) {
	sorted := append([]string{}, domains...)
	sort.Strings(sorted[1:])
	sum := sha256.Sum256([]byte(strings.Join(sorted, ",") + "|" + string(alg)))
	in := &acm.RequestCertificateInput{
		DomainName:       awssdk.String(domains[0]),
		ValidationMethod: acmtypes.ValidationMethodDns,
		KeyAlgorithm:     alg,
		IdempotencyToken: awssdk.String(hex.EncodeToString(sum[:])[:32]),
		Tags:             []acmtypes.Tag{{Key: awssdk.String("ManagedBy"), Value: awssdk.String("gen3-csoc")}},
	}
	if len(domains) > 1 {
		in.SubjectAlternativeNames = domains[1:]
	}
	out, err := certs.RequestCertificate(ctx, in)
	if err != nil {
		return "", err
	}
	return awssdk.ToString(out.CertificateArn), nil
}

type RecordsResult struct {
	// Written are the validation records now in Route 53, with their zone.
	Written []WrittenRecord `json:"written"`
	// Missing are the domains with no public zone in this account: their
	// records go wherever those domains are hosted.
	Missing []string `json:"missing,omitempty"`
}

type WrittenRecord struct {
	ValidationRecord
	Zone string `json:"zone"`
}

// writeValidationRecords is the console's "Create records in Route 53": each
// pending domain's record goes in the public zone that serves it.
func writeValidationRecords(ctx context.Context, d *CertificateDetail, zones zoneAPI) (*RecordsResult, error) {
	res := &RecordsResult{Written: []WrittenRecord{}}
	byZone := map[string][]ValidationRecord{}
	zoneName := map[string]string{}
	seen := map[string]bool{}
	for _, ds := range d.Domains {
		if ds.Record == nil || seen[ds.Record.Name] || ds.Status == string(acmtypes.DomainStatusSuccess) {
			continue
		}
		seen[ds.Record.Name] = true
		host := strings.TrimPrefix(ds.Domain, "*.")
		z, err := findPublicZone(ctx, zones, host)
		if err == nil && z == nil {
			z, err = findParentZone(ctx, zones, host)
		}
		if err != nil {
			return nil, fmt.Errorf("find the hosted zone for %s: %w", host, err)
		}
		if z == nil {
			res.Missing = append(res.Missing, ds.Domain)
			continue
		}
		id := zoneID(z)
		zoneName[id] = strings.TrimSuffix(awssdk.ToString(z.Name), ".")
		byZone[id] = append(byZone[id], *ds.Record)
	}
	ids := make([]string, 0, len(byZone))
	for id := range byZone {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		changes := make([]r53types.Change, 0, len(byZone[id]))
		for _, r := range byZone[id] {
			changes = append(changes, r53types.Change{
				Action: r53types.ChangeActionUpsert,
				ResourceRecordSet: &r53types.ResourceRecordSet{
					Name: awssdk.String(r.Name), Type: r53types.RRType(r.Type), TTL: awssdk.Int64(300),
					ResourceRecords: []r53types.ResourceRecord{{Value: awssdk.String(r.Value)}},
				},
			})
		}
		if _, err := zones.ChangeResourceRecordSets(ctx, &route53.ChangeResourceRecordSetsInput{
			HostedZoneId: awssdk.String(id),
			ChangeBatch:  &r53types.ChangeBatch{Comment: awssdk.String("ACM validation for " + d.DomainName), Changes: changes},
		}); err != nil {
			return nil, fmt.Errorf("write the validation records to %s: %w", zoneName[id], err)
		}
		for _, r := range byZone[id] {
			res.Written = append(res.Written, WrittenRecord{ValidationRecord: r, Zone: zoneName[id]})
		}
	}
	return res, nil
}

const maxPEM = 64 << 10

// checkImport is what ACM would refuse, caught before the call so the
// operator sees which part is wrong: the body must be one certificate, the
// key one private key, the chain certificates only.
func checkImport(body, key, chain string) error {
	if len(body) > maxPEM || len(key) > maxPEM || len(chain) > 4*maxPEM {
		return errors.New("too large for a certificate")
	}
	b, rest := pem.Decode([]byte(strings.TrimSpace(body)))
	if b == nil || b.Type != "CERTIFICATE" || len(strings.TrimSpace(string(rest))) > 0 {
		return errors.New("the certificate body must be one PEM CERTIFICATE block; put intermediates in the chain")
	}
	if _, err := x509.ParseCertificate(b.Bytes); err != nil {
		return fmt.Errorf("the certificate body does not parse: %w", err)
	}
	k, _ := pem.Decode([]byte(strings.TrimSpace(key)))
	if k == nil || !strings.HasSuffix(k.Type, "PRIVATE KEY") {
		return errors.New("the private key must be a PEM PRIVATE KEY block, unencrypted")
	}
	if k.Headers["Proc-Type"] != "" {
		return errors.New("the private key is encrypted; ACM needs it unencrypted")
	}
	for rest := []byte(strings.TrimSpace(chain)); len(strings.TrimSpace(string(rest))) > 0; {
		var c *pem.Block
		c, rest = pem.Decode(rest)
		if c == nil || c.Type != "CERTIFICATE" {
			return errors.New("the chain must be PEM CERTIFICATE blocks only")
		}
	}
	return nil
}

// CertSummary is a certificate in the account's list.
type CertSummary struct {
	ARN        string     `json:"arn"`
	DomainName string     `json:"domain_name"`
	Names      []string   `json:"names"`
	Status     string     `json:"status"`
	Type       string     `json:"type"`
	NotAfter   *time.Time `json:"not_after,omitempty"`
	InUse      bool       `json:"in_use"`
	// Covers says whether it covers every hostname asked about.
	Covers bool `json:"covers"`
}

func listCertificates(ctx context.Context, certs acmAPI, hosts []string) ([]CertSummary, error) {
	in := &acm.ListCertificatesInput{
		CertificateStatuses: []acmtypes.CertificateStatus{acmtypes.CertificateStatusIssued, acmtypes.CertificateStatusPendingValidation},
		Includes:            &acmtypes.Filters{KeyTypes: listedKeyTypes},
	}
	out := []CertSummary{}
	for {
		page, err := certs.ListCertificates(ctx, in)
		if err != nil {
			return nil, err
		}
		for _, s := range page.CertificateSummaryList {
			names := append([]string{awssdk.ToString(s.DomainName)}, s.SubjectAlternativeNameSummaries...)
			all := len(hosts) > 0
			for _, h := range hosts {
				one := false
				for _, n := range names {
					one = one || covers(n, h)
				}
				all = all && one
			}
			out = append(out, CertSummary{
				ARN: awssdk.ToString(s.CertificateArn), DomainName: awssdk.ToString(s.DomainName), Names: names,
				Status: string(s.Status), Type: string(s.Type), NotAfter: s.NotAfter, InUse: awssdk.ToBool(s.InUse), Covers: all,
			})
		}
		if page.NextToken == nil {
			break
		}
		in.NextToken = page.NextToken
	}
	// Those covering the hostnames first, issued before pending.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Covers != out[j].Covers {
			return out[i].Covers
		}
		return out[i].Status == string(acmtypes.CertificateStatusIssued) && out[j].Status != string(acmtypes.CertificateStatusIssued)
	})
	return out, nil
}

// ---- handlers ----

func acmClients(c *gin.Context, t Target, timeout time.Duration) (*acm.Client, *route53.Client, context.Context, context.CancelFunc, bool) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
	cfg, err := loadConfig(ctx, t)
	if err != nil {
		cancel()
		c.JSON(http.StatusBadRequest, ErrorBody(t.Profile, err))
		return nil, nil, nil, nil, false
	}
	return acm.NewFromConfig(cfg), route53.NewFromConfig(cfg), ctx, cancel, true
}

func acmFail(c *gin.Context, t Target, err error) {
	var nf *acmtypes.ResourceNotFoundException
	if errors.As(err, &nf) {
		c.JSON(http.StatusNotFound, gin.H{"error": "no such certificate in this account and region"})
		return
	}
	c.JSON(http.StatusBadGateway, ErrorBody(t.Profile, err))
}

// POST /api/aws/acm/request  {target..., domains, key_algorithm}
func ACMRequestHandler(c *gin.Context) {
	var req struct {
		Target
		Domains      []string `json:"domains"`
		KeyAlgorithm string   `json:"key_algorithm"`
	}
	if !bindTarget(c, &req) {
		return
	}
	domains, err := normalizeDomains(req.Domains)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	alg := acmtypes.KeyAlgorithmRsa2048
	if req.KeyAlgorithm != "" {
		a, ok := keyAlgorithms[req.KeyAlgorithm]
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "key_algorithm must be RSA_2048, EC_prime256v1 or EC_secp384r1"})
			return
		}
		alg = a
	}
	certs, _, ctx, cancel, ok := acmClients(c, req.Target, 60*time.Second)
	if !ok {
		return
	}
	defer cancel()
	arn, err := requestPublic(ctx, certs, domains, alg)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	// Its validation records appear a few seconds later; the wizard polls.
	d, err := describeCertificate(ctx, certs, arn)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// POST /api/aws/acm/describe  {target..., arn}
func ACMDescribeHandler(c *gin.Context) {
	var req struct {
		Target
		ARN string `json:"arn"`
	}
	if !bindTarget(c, &req) {
		return
	}
	if !validCertificateARN.MatchString(req.ARN) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not an ACM certificate ARN"})
		return
	}
	certs, _, ctx, cancel, ok := acmClients(c, req.Target, 30*time.Second)
	if !ok {
		return
	}
	defer cancel()
	d, err := describeCertificate(ctx, certs, req.ARN)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// POST /api/aws/acm/validation-records  {target..., arn}
func ACMRecordsHandler(c *gin.Context) {
	var req struct {
		Target
		ARN string `json:"arn"`
	}
	if !bindTarget(c, &req) {
		return
	}
	if !validCertificateARN.MatchString(req.ARN) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not an ACM certificate ARN"})
		return
	}
	certs, zones, ctx, cancel, ok := acmClients(c, req.Target, 60*time.Second)
	if !ok {
		return
	}
	defer cancel()
	d, err := describeCertificate(ctx, certs, req.ARN)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	res, err := writeValidationRecords(ctx, d, zones)
	if err != nil {
		c.JSON(http.StatusBadGateway, ErrorBody(req.Profile, err))
		return
	}
	c.JSON(http.StatusOK, res)
}

// POST /api/aws/acm/import  {target..., certificate, private_key, chain}
func ACMImportHandler(c *gin.Context) {
	var req struct {
		Target
		Certificate string `json:"certificate"`
		PrivateKey  string `json:"private_key"`
		Chain       string `json:"chain"`
	}
	if !bindTarget(c, &req) {
		return
	}
	if err := checkImport(req.Certificate, req.PrivateKey, req.Chain); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorBody(req.Profile, err))
		return
	}
	arn, err := importCertificate(ctx, acm.NewFromConfig(cfg), req.Certificate, req.PrivateKey, req.Chain)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	d, err := describeCertificate(ctx, acm.NewFromConfig(cfg), arn)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func importCertificate(ctx context.Context, certs acmConsoleAPI, body, key, chain string) (string, error) {
	in := &acm.ImportCertificateInput{
		Certificate: []byte(strings.TrimSpace(body)),
		PrivateKey:  []byte(strings.TrimSpace(key)),
		Tags:        []acmtypes.Tag{{Key: awssdk.String("ManagedBy"), Value: awssdk.String("gen3-csoc")}},
	}
	if strings.TrimSpace(chain) != "" {
		in.CertificateChain = []byte(strings.TrimSpace(chain))
	}
	out, err := certs.ImportCertificate(ctx, in)
	if err != nil {
		return "", err
	}
	return awssdk.ToString(out.CertificateArn), nil
}

// POST /api/aws/acm/list  {target..., hostnames}
func ACMListHandler(c *gin.Context) {
	var req struct {
		Target
		Hostnames []string `json:"hostnames"`
	}
	if !bindTarget(c, &req) {
		return
	}
	hosts, err := normalizeDomains(req.Hostnames)
	if err != nil {
		hosts = nil
	}
	certs, _, ctx, cancel, ok := acmClients(c, req.Target, 30*time.Second)
	if !ok {
		return
	}
	defer cancel()
	list, err := listCertificates(ctx, certs, hosts)
	if err != nil {
		acmFail(c, req.Target, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"certificates": list})
}

// CertificateStatus is ACM's status for arn (ISSUED, PENDING_VALIDATION,
// ...), read as t: what the install checks before giving the certificate
// to the load balancer.
func CertificateStatus(ctx context.Context, t Target, arn string) (string, error) {
	cfg, err := loadConfig(ctx, t)
	if err != nil {
		return "", err
	}
	d, err := describeCertificate(ctx, acm.NewFromConfig(cfg), arn)
	if err != nil {
		return "", errors.New(awsErrorMessage(err))
	}
	return d.Status, nil
}

type acmDeleteAPI interface {
	acmAPI
	ListTagsForCertificate(context.Context, *acm.ListTagsForCertificateInput, ...func(*acm.Options)) (*acm.ListTagsForCertificateOutput, error)
	DeleteCertificate(context.Context, *acm.DeleteCertificateInput, ...func(*acm.Options)) (*acm.DeleteCertificateOutput, error)
}

var errNotOurCertificate = errors.New("the certificate was not made by the CSOC bootstrap (no ManagedBy=gen3-csoc tag), so it is left alone")

// deleteCertificate removes a certificate the bootstrap requested or
// imported, with the validation records it wrote for it: once the zone goes
// it could not renew anyway. A certificate still attached to a load
// balancer is left.
func deleteCertificate(ctx context.Context, certs acmDeleteAPI, zones zoneAPI, arn string) (int, error) {
	tags, err := certs.ListTagsForCertificate(ctx, &acm.ListTagsForCertificateInput{CertificateArn: awssdk.String(arn)})
	if err != nil {
		return 0, err
	}
	ours := false
	for _, t := range tags.Tags {
		ours = ours || (awssdk.ToString(t.Key) == "ManagedBy" && awssdk.ToString(t.Value) == "gen3-csoc")
	}
	if !ours {
		return 0, errNotOurCertificate
	}
	d, err := describeCertificate(ctx, certs, arn)
	if err != nil {
		return 0, err
	}
	if len(d.InUseBy) > 0 {
		return 0, fmt.Errorf("the certificate is still in use by %s", strings.Join(d.InUseBy, ", "))
	}
	removed := 0
	seen := map[string]bool{}
	for _, ds := range d.Domains {
		if ds.Record == nil || seen[ds.Record.Name] {
			continue
		}
		seen[ds.Record.Name] = true
		host := strings.TrimPrefix(ds.Domain, "*.")
		z, err := findPublicZone(ctx, zones, host)
		if err == nil && z == nil {
			z, err = findParentZone(ctx, zones, host)
		}
		if err != nil || z == nil {
			continue
		}
		out, err := zones.ListResourceRecordSets(ctx, &route53.ListResourceRecordSetsInput{
			HostedZoneId: awssdk.String(zoneID(z)), StartRecordName: awssdk.String(ds.Record.Name),
			StartRecordType: r53types.RRTypeCname, MaxItems: awssdk.Int32(1),
		})
		if err != nil {
			return removed, err
		}
		for _, rr := range out.ResourceRecordSets {
			if !sameName(awssdk.ToString(rr.Name), ds.Record.Name) || rr.Type != r53types.RRTypeCname {
				continue
			}
			match := false
			for _, v := range rr.ResourceRecords {
				match = match || sameName(awssdk.ToString(v.Value), ds.Record.Value)
			}
			if !match {
				continue // someone else's record of that name
			}
			if err := deleteRecords(ctx, zones, zoneID(z), []r53types.ResourceRecordSet{rr}); err != nil {
				return removed, err
			}
			removed++
		}
	}
	if _, err := certs.DeleteCertificate(ctx, &acm.DeleteCertificateInput{CertificateArn: awssdk.String(arn)}); err != nil {
		var nf *acmtypes.ResourceNotFoundException
		if !errors.As(err, &nf) {
			return removed, err
		}
	}
	return removed, nil
}

// POST /api/aws/acm/delete  {target..., arn}
func ACMDeleteHandler(c *gin.Context) {
	var req struct {
		Target
		ARN string `json:"arn"`
	}
	if !bindTarget(c, &req) {
		return
	}
	if !validCertificateARN.MatchString(req.ARN) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not an ACM certificate ARN"})
		return
	}
	certs, zones, ctx, cancel, ok := acmClients(c, req.Target, 60*time.Second)
	if !ok {
		return
	}
	defer cancel()
	n, err := deleteCertificate(ctx, certs, zones, req.ARN)
	switch {
	case errors.Is(err, errNotOurCertificate):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case err != nil:
		var nf *acmtypes.ResourceNotFoundException
		if errors.As(err, &nf) {
			c.JSON(http.StatusOK, gin.H{"deleted": true, "records_removed": 0, "note": "it was already gone"})
			return
		}
		acmFail(c, req.Target, err)
	default:
		c.JSON(http.StatusOK, gin.H{"deleted": true, "records_removed": n})
	}
}
