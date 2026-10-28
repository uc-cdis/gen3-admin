package environments

import (
	"context"
	"errors"
	"strings"
	"testing"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/uc-cdis/gen3-admin/internal/environments/envtest"
)

// versionedS3 adds the versioned listing and deletes to the in-memory S3,
// with one version per object.
type versionedS3 struct {
	*envtest.MemS3
	bucketDeleted bool
}

func (v *versionedS3) ListObjectVersions(_ context.Context, _ *s3.ListObjectVersionsInput, _ ...func(*s3.Options)) (*s3.ListObjectVersionsOutput, error) {
	out := &s3.ListObjectVersionsOutput{IsTruncated: awssdk.Bool(false)}
	for k := range v.Objects {
		out.Versions = append(out.Versions, s3types.ObjectVersion{Key: awssdk.String(k), VersionId: awssdk.String("v1")})
	}
	return out, nil
}

func (v *versionedS3) DeleteObjects(_ context.Context, in *s3.DeleteObjectsInput, _ ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	for _, o := range in.Delete.Objects {
		delete(v.Objects, awssdk.ToString(o.Key))
	}
	return &s3.DeleteObjectsOutput{}, nil
}

func (v *versionedS3) DeleteBucket(context.Context, *s3.DeleteBucketInput, ...func(*s3.Options)) (*s3.DeleteBucketOutput, error) {
	if len(v.Objects) > 0 {
		return nil, errors.New("BucketNotEmpty")
	}
	v.bucketDeleted = true
	return &s3.DeleteBucketOutput{}, nil
}

func newVersioned(t *testing.T, status Status) *versionedS3 {
	t.Helper()
	api := &versionedS3{MemS3: envtest.NewMemS3()}
	store := NewStore(api, "b")
	ctx := context.Background()
	if _, err := store.Save(ctx, &Environment{Name: "dev", Kind: KindCSOC}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(ctx, "dev", func(e *Environment) { e.Status = status }); err != nil {
		t.Fatal(err)
	}
	api.Objects[StateKey("dev")] = []byte("{}")
	return api
}

func TestDeleteStateBucketOnceEverythingIsDestroyed(t *testing.T) {
	api := newVersioned(t, StatusDestroyed)
	n, err := deleteStateBucket(context.Background(), api, "b")
	if err != nil || n != 2 || !api.bucketDeleted {
		t.Errorf("delete = %d, %v; bucket deleted %v", n, err, api.bucketDeleted)
	}
}

func TestDeleteStateBucketRefusesWhileAnEnvironmentIsUp(t *testing.T) {
	api := newVersioned(t, StatusPartial)
	_, err := deleteStateBucket(context.Background(), api, "b")
	var blocked *BucketBlocked
	if !errors.As(err, &blocked) || len(blocked.Environments) != 1 || !strings.Contains(blocked.Environments[0], "partial") || api.bucketDeleted {
		t.Errorf("err = %v, bucket deleted %v", err, api.bucketDeleted)
	}
}

func TestDeleteStateBucketLeavesSharedBuckets(t *testing.T) {
	api := newVersioned(t, StatusDestroyed)
	api.Objects["other-team/terraform.tfstate"] = []byte("{}")
	_, err := deleteStateBucket(context.Background(), api, "b")
	var blocked *BucketBlocked
	if !errors.As(err, &blocked) || len(blocked.Foreign) != 1 || len(api.Objects) != 3 || api.bucketDeleted {
		t.Errorf("err = %v, objects left %d", err, len(api.Objects))
	}
}
