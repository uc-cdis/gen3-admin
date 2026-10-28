package aws

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/acm"
	acmtypes "github.com/aws/aws-sdk-go-v2/service/acm/types"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
	"github.com/gin-gonic/gin"
)

// A Gen3 commons served by the AWS load balancer controller needs an ACM
// certificate for its hostname. The deploy wizard asks for one here: an
// existing certificate that covers the name is reused, and otherwise one is
// requested with DNS validation, and its validation record written to the
// hosted zone that serves the name. ACM issues it a few minutes later, once
// it sees the record.

// acmAPI is the part of the ACM client the certificate request uses.
type acmAPI interface {
	ListCertificates(context.Context, *acm.ListCertificatesInput, ...func(*acm.Options)) (*acm.ListCertificatesOutput, error)
	DescribeCertificate(context.Context, *acm.DescribeCertificateInput, ...func(*acm.Options)) (*acm.DescribeCertificateOutput, error)
	RequestCertificate(context.Context, *acm.RequestCertificateInput, ...func(*acm.Options)) (*acm.RequestCertificateOutput, error)
}

// ValidationRecord is the DNS record ACM checks before issuing.
type ValidationRecord struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Value string `json:"value"`
}

type CertificateResult struct {
	ARN      string `json:"arn"`
	Hostname string `json:"hostname"`
	// Status is ACM's: PENDING_VALIDATION, ISSUED, FAILED, ...
	Status string `json:"status"`
	// Reused: an existing certificate already covered the hostname.
	Reused  bool               `json:"reused"`
	Records []ValidationRecord `json:"records,omitempty"`
	// ZoneID is where the validation records were written; empty when no
	// zone this identity can reach serves the name, and the operator adds
	// Records where the domain is hosted.
	ZoneID string `json:"hosted_zone_id,omitempty"`
}

var validCertificateARN = regexp.MustCompile(`^arn:aws[a-z-]*:acm:[a-z0-9-]+:[0-9]{12}:certificate/[0-9a-f-]{36}$`)

// How long a fresh request waits for ACM to publish its validation record,
// and how often it looks. Variables so tests need not wait.
var (
	recordWait  = 30 * time.Second
	recordEvery = 2 * time.Second
)

// covers says whether a certificate name (exact, or a one-level wildcard)
// covers host.
func covers(name, host string) bool {
	name = strings.ToLower(name)
	if name == host {
		return true
	}
	if rest, ok := strings.CutPrefix(name, "*."); ok {
		_, parent, found := strings.Cut(host, ".")
		return found && parent == rest
	}
	return false
}

// findCertificate returns the best certificate covering host: an issued one
// before one still pending validation.
func findCertificate(ctx context.Context, certs acmAPI, host string) (*acmtypes.CertificateSummary, error) {
	var pending *acmtypes.CertificateSummary
	in := &acm.ListCertificatesInput{
		CertificateStatuses: []acmtypes.CertificateStatus{acmtypes.CertificateStatusIssued, acmtypes.CertificateStatusPendingValidation},
	}
	for {
		out, err := certs.ListCertificates(ctx, in)
		if err != nil {
			return nil, err
		}
		for i := range out.CertificateSummaryList {
			s := &out.CertificateSummaryList[i]
			names := append([]string{awssdk.ToString(s.DomainName)}, s.SubjectAlternativeNameSummaries...)
			match := false
			for _, n := range names {
				if covers(n, host) {
					match = true
					break
				}
			}
			if !match {
				continue
			}
			if s.Status == acmtypes.CertificateStatusIssued {
				return s, nil
			}
			if pending == nil {
				pending = s
			}
		}
		if out.NextToken == nil {
			return pending, nil
		}
		in.NextToken = out.NextToken
	}
}

// validationRecords reads a certificate's status and the records ACM checks.
func validationRecords(ctx context.Context, certs acmAPI, arn string) (string, []ValidationRecord, error) {
	out, err := certs.DescribeCertificate(ctx, &acm.DescribeCertificateInput{CertificateArn: awssdk.String(arn)})
	if err != nil {
		return "", nil, err
	}
	var records []ValidationRecord
	seen := map[string]bool{}
	for _, o := range out.Certificate.DomainValidationOptions {
		if o.ResourceRecord == nil {
			continue
		}
		r := ValidationRecord{Name: awssdk.ToString(o.ResourceRecord.Name), Type: string(o.ResourceRecord.Type), Value: awssdk.ToString(o.ResourceRecord.Value)}
		// A name and its wildcard share one record.
		if !seen[r.Name] {
			seen[r.Name] = true
			records = append(records, r)
		}
	}
	return string(out.Certificate.Status), records, nil
}

// idempotencyToken makes a repeated request for the same hostname return the
// same certificate rather than a second one (within ACM's hour).
func idempotencyToken(host string) string {
	sum := sha256.Sum256([]byte(host))
	return hex.EncodeToString(sum[:])[:32]
}

// requestCertificate finds or requests a certificate for host, and writes its
// validation records to the zone serving host, when zones can reach one.
func requestCertificate(ctx context.Context, certs acmAPI, zones zoneAPI, host string) (*CertificateResult, error) {
	res := &CertificateResult{Hostname: host}
	existing, err := findCertificate(ctx, certs, host)
	if err != nil {
		return nil, fmt.Errorf("list certificates: %w", err)
	}
	if existing != nil {
		res.ARN, res.Reused = awssdk.ToString(existing.CertificateArn), true
	} else {
		out, err := certs.RequestCertificate(ctx, &acm.RequestCertificateInput{
			DomainName:       awssdk.String(host),
			ValidationMethod: acmtypes.ValidationMethodDns,
			IdempotencyToken: awssdk.String(idempotencyToken(host)),
			Tags:             []acmtypes.Tag{{Key: awssdk.String("ManagedBy"), Value: awssdk.String("gen3-csoc")}},
		})
		if err != nil {
			return nil, fmt.Errorf("request certificate: %w", err)
		}
		res.ARN = awssdk.ToString(out.CertificateArn)
	}

	// A new request has no validation record for the first few seconds.
	deadline := time.Now().Add(recordWait)
	for {
		res.Status, res.Records, err = validationRecords(ctx, certs, res.ARN)
		if err != nil {
			return nil, fmt.Errorf("describe certificate: %w", err)
		}
		if res.Status != string(acmtypes.CertificateStatusPendingValidation) || len(res.Records) > 0 || time.Now().After(deadline) {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(recordEvery):
		}
	}
	if res.Status != string(acmtypes.CertificateStatusPendingValidation) || len(res.Records) == 0 {
		return res, nil
	}

	zone, err := findPublicZone(ctx, zones, host)
	if err == nil && zone == nil {
		zone, err = findParentZone(ctx, zones, host)
	}
	if err != nil {
		return nil, fmt.Errorf("find the hosted zone for %s: %w", host, err)
	}
	if zone == nil {
		return res, nil
	}
	res.ZoneID = zoneID(zone)
	changes := make([]r53types.Change, 0, len(res.Records))
	for _, r := range res.Records {
		changes = append(changes, r53types.Change{
			Action: r53types.ChangeActionUpsert,
			ResourceRecordSet: &r53types.ResourceRecordSet{
				Name: awssdk.String(r.Name), Type: r53types.RRType(r.Type), TTL: awssdk.Int64(300),
				ResourceRecords: []r53types.ResourceRecord{{Value: awssdk.String(r.Value)}},
			},
		})
	}
	if _, err := zones.ChangeResourceRecordSets(ctx, &route53.ChangeResourceRecordSetsInput{
		HostedZoneId: awssdk.String(res.ZoneID),
		ChangeBatch:  &r53types.ChangeBatch{Comment: awssdk.String("ACM validation for " + host), Changes: changes},
	}); err != nil {
		return nil, fmt.Errorf("write the validation record: %w", err)
	}
	return res, nil
}

// CertificateRequestHandler: POST /api/aws/acm/certificate
// {target..., hostname}. Finds or requests a certificate for the hostname,
// in the target's region (the one the commons' load balancer is in).
func CertificateRequestHandler(c *gin.Context) {
	var req struct {
		Target
		Hostname string `json:"hostname"`
	}
	if !bindTarget(c, &req) {
		return
	}
	host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(req.Hostname)), ".")
	if !validDomain.MatchString(host) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hostname must be a DNS name, such as commons.example.org"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := requestCertificate(ctx, acm.NewFromConfig(cfg), route53.NewFromConfig(cfg), host)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": awsErrorMessage(err)})
		return
	}
	c.JSON(http.StatusOK, res)
}

// CertificateStatusHandler: POST /api/aws/acm/certificate/status
// {target..., arn}. What the wizard polls until the certificate is issued.
func CertificateStatusHandler(c *gin.Context) {
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	status, records, err := validationRecords(ctx, acm.NewFromConfig(cfg), req.ARN)
	if err != nil {
		var nf *acmtypes.ResourceNotFoundException
		if errors.As(err, &nf) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no such certificate"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": awsErrorMessage(err)})
		return
	}
	c.JSON(http.StatusOK, CertificateResult{ARN: req.ARN, Status: status, Records: records})
}
