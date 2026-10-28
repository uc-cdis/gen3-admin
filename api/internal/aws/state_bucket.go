package aws

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	smithyhttp "github.com/aws/smithy-go/transport/http"
	"github.com/gin-gonic/gin"
)

var validBucket = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// stateBucketAPI is the slice of the S3 client the state bucket check uses,
// so tests can stand in for S3.
type stateBucketAPI interface {
	HeadBucket(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error)
	CreateBucket(context.Context, *s3.CreateBucketInput, ...func(*s3.Options)) (*s3.CreateBucketOutput, error)
	GetBucketVersioning(context.Context, *s3.GetBucketVersioningInput, ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error)
	PutBucketVersioning(context.Context, *s3.PutBucketVersioningInput, ...func(*s3.Options)) (*s3.PutBucketVersioningOutput, error)
	PutBucketEncryption(context.Context, *s3.PutBucketEncryptionInput, ...func(*s3.Options)) (*s3.PutBucketEncryptionOutput, error)
	PutPublicAccessBlock(context.Context, *s3.PutPublicAccessBlockInput, ...func(*s3.Options)) (*s3.PutPublicAccessBlockOutput, error)
	PutBucketPolicy(context.Context, *s3.PutBucketPolicyInput, ...func(*s3.Options)) (*s3.PutBucketPolicyOutput, error)
}

// StateBucketStatus is what the wizard needs to know before pointing
// Terraform at a bucket.
type StateBucketStatus struct {
	Bucket     string `json:"bucket"`
	Exists     bool   `json:"exists"`
	Created    bool   `json:"created"`
	Region     string `json:"region,omitempty"`
	Versioning bool   `json:"versioning"`
	// Forbidden means the bucket exists but this account does not own it or
	// cannot reach it. Bucket names are global, so this is the common result
	// for a name someone else already took.
	Forbidden bool `json:"forbidden,omitempty"`
}

// checkStateBucket reports on a bucket and, when create is set and it does
// not exist, creates it the way Terraform state should be kept: versioned so
// a bad apply can be rolled back, encrypted, never public, TLS only.
//
// ExpectedBucketOwner pins every call to the caller's account, so a bucket of
// the same name in someone else's account is reported rather than written to.
func checkStateBucket(ctx context.Context, api stateBucketAPI, bucket, region, account string, create bool) (StateBucketStatus, error) {
	st := StateBucketStatus{Bucket: bucket}
	owner := awssdk.String(account)

	head, err := api.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &bucket, ExpectedBucketOwner: owner})
	// A bucket in another region answers 301 from this one, naming its own
	// region in a header: ask again there. State may well live in a region
	// other than the one being deployed to.
	var inRegion []func(*s3.Options)
	if r := bucketRegionOf(err); httpStatus(err) == http.StatusMovedPermanently && r != "" {
		inRegion = []func(*s3.Options){func(o *s3.Options) { o.Region = r }}
		head, err = api.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &bucket, ExpectedBucketOwner: owner}, inRegion...)
	}
	switch status := httpStatus(err); {
	case err == nil:
		st.Exists = true
		st.Region = awssdk.ToString(head.BucketRegion)
	case status == http.StatusForbidden:
		st.Exists, st.Forbidden = true, true
		return st, nil
	case status == http.StatusNotFound:
		if !create {
			return st, nil
		}
		if err := createStateBucket(ctx, api, bucket, region, owner); err != nil {
			return st, err
		}
		st.Exists, st.Created, st.Region, st.Versioning = true, true, region, true
		return st, nil
	default:
		return st, err
	}

	v, err := api.GetBucketVersioning(ctx, &s3.GetBucketVersioningInput{Bucket: &bucket, ExpectedBucketOwner: owner}, inRegion...)
	if err != nil {
		return st, err
	}
	st.Versioning = v.Status == s3types.BucketVersioningStatusEnabled
	return st, nil
}

func createStateBucket(ctx context.Context, api stateBucketAPI, bucket, region string, owner *string) error {
	in := &s3.CreateBucketInput{Bucket: &bucket}
	// us-east-1 is the one region that rejects an explicit location.
	if region != "us-east-1" {
		in.CreateBucketConfiguration = &s3types.CreateBucketConfiguration{
			LocationConstraint: s3types.BucketLocationConstraint(region),
		}
	}
	if _, err := api.CreateBucket(ctx, in); err != nil {
		return fmt.Errorf("create bucket: %w", err)
	}

	steps := []struct {
		name string
		run  func() error
	}{
		{"block public access", func() error {
			_, err := api.PutPublicAccessBlock(ctx, &s3.PutPublicAccessBlockInput{
				Bucket: &bucket, ExpectedBucketOwner: owner,
				PublicAccessBlockConfiguration: &s3types.PublicAccessBlockConfiguration{
					BlockPublicAcls: awssdk.Bool(true), BlockPublicPolicy: awssdk.Bool(true),
					IgnorePublicAcls: awssdk.Bool(true), RestrictPublicBuckets: awssdk.Bool(true),
				},
			})
			return err
		}},
		{"enable versioning", func() error {
			_, err := api.PutBucketVersioning(ctx, &s3.PutBucketVersioningInput{
				Bucket: &bucket, ExpectedBucketOwner: owner,
				VersioningConfiguration: &s3types.VersioningConfiguration{Status: s3types.BucketVersioningStatusEnabled},
			})
			return err
		}},
		{"enable encryption", func() error {
			_, err := api.PutBucketEncryption(ctx, &s3.PutBucketEncryptionInput{
				Bucket: &bucket, ExpectedBucketOwner: owner,
				ServerSideEncryptionConfiguration: &s3types.ServerSideEncryptionConfiguration{
					Rules: []s3types.ServerSideEncryptionRule{{
						ApplyServerSideEncryptionByDefault: &s3types.ServerSideEncryptionByDefault{
							SSEAlgorithm: s3types.ServerSideEncryptionAes256,
						},
					}},
				},
			})
			return err
		}},
		{"require TLS", func() error {
			_, err := api.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
				Bucket: &bucket, ExpectedBucketOwner: owner, Policy: awssdk.String(tlsOnlyPolicy(bucket)),
			})
			return err
		}},
	}
	for _, s := range steps {
		if err := s.run(); err != nil {
			return fmt.Errorf("bucket created but could not %s: %w", s.name, err)
		}
	}
	return nil
}

func tlsOnlyPolicy(bucket string) string {
	return fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::%[1]s","arn:aws:s3:::%[1]s/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}`, bucket)
}

// bucketRegionOf is the region S3 names in a redirect (x-amz-bucket-region).
func bucketRegionOf(err error) string {
	var re *smithyhttp.ResponseError
	if errors.As(err, &re) && re.Response != nil {
		if r := re.Response.Header.Get("X-Amz-Bucket-Region"); validRegionName.MatchString(r) {
			return r
		}
	}
	return ""
}

func httpStatus(err error) int {
	var re *smithyhttp.ResponseError
	if errors.As(err, &re) {
		return re.HTTPStatusCode()
	}
	return 0
}

// StateBucketHandler checks, and optionally creates, the bucket that will
// hold Terraform state and the environment registry.
// POST /api/aws/state-bucket  {bucket, create, region, profile | credentials}
func StateBucketHandler(c *gin.Context) {
	var req struct {
		Target
		Bucket string `json:"bucket"`
		Create bool   `json:"create"`
	}
	if !bindTarget(c, &req) {
		return
	}
	if !validBucket.MatchString(req.Bucket) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not a valid S3 bucket name"})
		return
	}

	ctx, cancel := lookupContext(c)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		c.JSON(http.StatusUnauthorized, identityError(req.Profile, err))
		return
	}

	st, err := checkStateBucket(ctx, s3.NewFromConfig(cfg), req.Bucket, cfg.Region, awssdk.ToString(id.Account), req.Create)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": awsErrorMessage(err)})
		return
	}
	c.JSON(http.StatusOK, st)
}
