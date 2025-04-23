package awspkg

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/acm"
	acmtypes "github.com/aws/aws-sdk-go-v2/service/acm/types"
	"github.com/gin-gonic/gin"
)

// Certificate represents a simplified ACM certificate info for the frontend
type Certificate struct {
	Arn        string   `json:"arn"`
	DomainName string   `json:"domainName"`
	SANs       []string `json:"subjectAlternativeNames"`
	Status     string   `json:"status"`
	Issuer     string   `json:"issuer"`
	NotBefore  string   `json:"notBefore"`
	NotAfter   string   `json:"notAfter"`
}

// ListCertificatesHandler fetches ACM certs and returns them
func ListCertificatesHandler(c *gin.Context) {
	ctx := context.Background()

	// Load default AWS config (env vars, shared config, IAM roles, etc.)
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("failed to load AWS config: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AWS config error"})
		return
	}

	acmClient := acm.NewFromConfig(cfg)

	// List certificates
	output, err := acmClient.ListCertificates(ctx, &acm.ListCertificatesInput{
		CertificateStatuses: []acmtypes.CertificateStatus{
			acmtypes.CertificateStatusIssued,
		},
	})
	if err != nil {
		log.Printf("failed to list certificates: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list certificates"})
		return
	}

	// Fetch full cert details for each certificate
	var certs []Certificate
	for _, certSummary := range output.CertificateSummaryList {
		detail, err := acmClient.DescribeCertificate(ctx, &acm.DescribeCertificateInput{
			CertificateArn: certSummary.CertificateArn,
		})
		if err != nil {
			log.Printf("failed to describe certificate %s: %v", aws.ToString(certSummary.CertificateArn), err)
			continue
		}
		certDetail := detail.Certificate
		if certDetail == nil {
			continue
		}

		// Check if DomainName or any SAN starts with "*"
		isWildcard := false

		if certDetail.DomainName != nil && strings.HasPrefix(*certDetail.DomainName, "*") {
			isWildcard = true
		} else if certDetail.SubjectAlternativeNames != nil {
			for _, san := range certDetail.SubjectAlternativeNames {
				if strings.HasPrefix(san, "*") {
					isWildcard = true
					break
				}
			}
		}

		if !isWildcard {
			// Skip non-wildcard certs
			continue
		}

		certs = append(certs, Certificate{
			Arn:        aws.ToString(certDetail.CertificateArn),
			DomainName: aws.ToString(certDetail.DomainName),
			SANs:       certDetail.SubjectAlternativeNames,
			Status:     string(certDetail.Status),
			Issuer:     aws.ToString(certDetail.Issuer),
			NotBefore:  certDetail.NotBefore.Format("2006-01-02"),
			NotAfter:   certDetail.NotAfter.Format("2006-01-02"),
		})
	}

	c.JSON(http.StatusOK, certs)
}
