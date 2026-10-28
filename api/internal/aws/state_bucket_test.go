package aws

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

type fakeS3 struct {
	headStatus int // 0 means the bucket exists
	versioning s3types.BucketVersioningStatus
	calls      []string
	owners     []string
	createIn   *s3.CreateBucketInput
}

func statusErr(code int) error {
	return &smithyhttp.ResponseError{Response: &smithyhttp.Response{Response: &http.Response{StatusCode: code}}, Err: errors.New("x")}
}

func (f *fakeS3) note(name string, owner *string) {
	f.calls = append(f.calls, name)
	f.owners = append(f.owners, awssdk.ToString(owner))
}

func (f *fakeS3) HeadBucket(_ context.Context, in *s3.HeadBucketInput, _ ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
	f.note("head", in.ExpectedBucketOwner)
	if f.headStatus != 0 {
		return nil, statusErr(f.headStatus)
	}
	return &s3.HeadBucketOutput{BucketRegion: awssdk.String("us-west-2")}, nil
}
func (f *fakeS3) CreateBucket(_ context.Context, in *s3.CreateBucketInput, _ ...func(*s3.Options)) (*s3.CreateBucketOutput, error) {
	f.calls = append(f.calls, "create")
	f.createIn = in
	return &s3.CreateBucketOutput{}, nil
}
func (f *fakeS3) GetBucketVersioning(_ context.Context, in *s3.GetBucketVersioningInput, _ ...func(*s3.Options)) (*s3.GetBucketVersioningOutput, error) {
	f.note("get-versioning", in.ExpectedBucketOwner)
	return &s3.GetBucketVersioningOutput{Status: f.versioning}, nil
}
func (f *fakeS3) PutBucketVersioning(_ context.Context, in *s3.PutBucketVersioningInput, _ ...func(*s3.Options)) (*s3.PutBucketVersioningOutput, error) {
	f.note("versioning", in.ExpectedBucketOwner)
	return &s3.PutBucketVersioningOutput{}, nil
}
func (f *fakeS3) PutBucketEncryption(_ context.Context, in *s3.PutBucketEncryptionInput, _ ...func(*s3.Options)) (*s3.PutBucketEncryptionOutput, error) {
	f.note("encryption", in.ExpectedBucketOwner)
	return &s3.PutBucketEncryptionOutput{}, nil
}
func (f *fakeS3) PutPublicAccessBlock(_ context.Context, in *s3.PutPublicAccessBlockInput, _ ...func(*s3.Options)) (*s3.PutPublicAccessBlockOutput, error) {
	f.note("public-access-block", in.ExpectedBucketOwner)
	return &s3.PutPublicAccessBlockOutput{}, nil
}
func (f *fakeS3) PutBucketPolicy(_ context.Context, in *s3.PutBucketPolicyInput, _ ...func(*s3.Options)) (*s3.PutBucketPolicyOutput, error) {
	f.note("policy", in.ExpectedBucketOwner)
	return &s3.PutBucketPolicyOutput{}, nil
}

func TestStateBucketCreatesHardenedBucket(t *testing.T) {
	f := &fakeS3{headStatus: http.StatusNotFound}
	st, err := checkStateBucket(context.Background(), f, "my-state", "us-west-2", "111122223333", true)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Created || !st.Versioning {
		t.Errorf("status = %+v, want created and versioned", st)
	}
	want := "head create public-access-block versioning encryption policy"
	if got := strings.Join(f.calls, " "); got != want {
		t.Errorf("calls = %q, want %q", got, want)
	}
	if f.createIn.CreateBucketConfiguration == nil || f.createIn.CreateBucketConfiguration.LocationConstraint != "us-west-2" {
		t.Errorf("create outside us-east-1 must set the location constraint")
	}
	for i, o := range f.owners {
		if o != "111122223333" {
			t.Errorf("call %d ran without pinning the bucket owner", i)
		}
	}
}

func TestStateBucketUSEast1HasNoLocationConstraint(t *testing.T) {
	f := &fakeS3{headStatus: http.StatusNotFound}
	if _, err := checkStateBucket(context.Background(), f, "my-state", "us-east-1", "111122223333", true); err != nil {
		t.Fatal(err)
	}
	if f.createIn.CreateBucketConfiguration != nil {
		t.Errorf("us-east-1 rejects an explicit location constraint")
	}
}

func TestStateBucketMissingWithoutCreateOnlyReports(t *testing.T) {
	f := &fakeS3{headStatus: http.StatusNotFound}
	st, err := checkStateBucket(context.Background(), f, "my-state", "us-east-1", "111122223333", false)
	if err != nil || st.Exists || len(f.calls) != 1 {
		t.Errorf("status = %+v err = %v calls = %v, want a report and nothing created", st, err, f.calls)
	}
}

func TestStateBucketOwnedElsewhereIsForbidden(t *testing.T) {
	f := &fakeS3{headStatus: http.StatusForbidden}
	st, err := checkStateBucket(context.Background(), f, "taken", "us-east-1", "111122223333", true)
	if err != nil || !st.Forbidden || len(f.calls) != 1 {
		t.Errorf("status = %+v err = %v calls = %v, want forbidden and no writes", st, err, f.calls)
	}
}

func TestStateBucketExistingReportsVersioning(t *testing.T) {
	f := &fakeS3{versioning: s3types.BucketVersioningStatusEnabled}
	st, err := checkStateBucket(context.Background(), f, "mine", "us-east-1", "111122223333", true)
	if err != nil || !st.Exists || st.Created || !st.Versioning || st.Region != "us-west-2" {
		t.Errorf("status = %+v err = %v", st, err)
	}
}

func TestStateBucketRejectsBadName(t *testing.T) {
	for _, b := range []string{"", "UPPER", "a", "-lead", "has space", "x;id"} {
		if code, _ := post(t, StateBucketHandler, map[string]any{"bucket": b}); code != http.StatusBadRequest {
			t.Errorf("bucket %q: status %d, want 400", b, code)
		}
	}
}

func TestLoadConfigRejectsBadRoleARN(t *testing.T) {
	for _, arn := range []string{"arn:aws:iam::123:role/x", "role/x", "arn:aws:iam::111122223333:user/x"} {
		if _, err := loadConfig(context.Background(), Target{RoleARN: arn}); err == nil {
			t.Errorf("role %q accepted", arn)
		}
	}
}

func TestIdentityErrorFlagsExpiredSSO(t *testing.T) {
	err := errors.New("operation error STS: GetCallerIdentity, get identity: get credentials: failed to refresh cached credentials, the SSO session has expired or is invalid")
	h := identityError("dev", err)
	if h["code"] != "sso_expired" || h["login_command"] != "aws sso login --profile dev" {
		t.Errorf("identityError = %v, want an sso_expired code with the login command", h)
	}
	if h := identityError("dev", errors.New("InvalidClientTokenId: The security token included in the request is invalid")); h["code"] != nil {
		t.Errorf("non-SSO error flagged as SSO: %v", h)
	}
}

// regionalS3 is a bucket in us-east-1 seen from a client in another region:
// asked anywhere else, S3 answers 301 and names the bucket's region.
type regionalS3 struct{ fakeS3 }

func (f *regionalS3) HeadBucket(ctx context.Context, in *s3.HeadBucketInput, opts ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
	o := s3.Options{Region: "us-west-2"}
	for _, fn := range opts {
		fn(&o)
	}
	if o.Region != "us-east-1" {
		h := http.Header{}
		h.Set("X-Amz-Bucket-Region", "us-east-1")
		return nil, &smithyhttp.ResponseError{Response: &smithyhttp.Response{Response: &http.Response{StatusCode: http.StatusMovedPermanently, Header: h}}, Err: errors.New("MovedPermanently")}
	}
	return &s3.HeadBucketOutput{BucketRegion: awssdk.String("us-east-1")}, nil
}

func TestStateBucketInAnotherRegion(t *testing.T) {
	api := &regionalS3{fakeS3{versioning: s3types.BucketVersioningStatusEnabled}}
	st, err := checkStateBucket(context.Background(), api, "state", "us-west-2", "123456789012", false)
	if err != nil {
		t.Fatalf("a bucket in another region must be found there, not reported as an error: %v", err)
	}
	if !st.Exists || st.Region != "us-east-1" || !st.Versioning {
		t.Errorf("status = %+v", st)
	}
}
