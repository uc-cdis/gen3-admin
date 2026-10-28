package environments

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/gin-gonic/gin"

	awslookup "github.com/uc-cdis/gen3-admin/internal/aws"
)

// The state bucket goes last when an account is taken back to blank: it
// holds every environment's state and the registry itself. It is only
// deleted when every environment in it is destroyed (or never built), and
// when it holds nothing but what the bootstrap wrote, so a bucket shared
// with other state is never emptied.

type bucketTeardownAPI interface {
	S3API
	ListObjectVersions(context.Context, *s3.ListObjectVersionsInput, ...func(*s3.Options)) (*s3.ListObjectVersionsOutput, error)
	DeleteObjects(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
	DeleteBucket(context.Context, *s3.DeleteBucketInput, ...func(*s3.Options)) (*s3.DeleteBucketOutput, error)
}

// bootstrapRoot is everything the bootstrap writes to the bucket.
const bootstrapRoot = "gen3-csoc/"

// BucketBlocked explains why a bucket was not deleted.
type BucketBlocked struct {
	Environments []string `json:"environments,omitempty"` // not yet destroyed
	Foreign      []string `json:"foreign,omitempty"`      // objects the bootstrap did not write
}

func (b *BucketBlocked) Error() string {
	if len(b.Environments) > 0 {
		return "destroy these environments first: " + strings.Join(b.Environments, ", ")
	}
	return "the bucket holds objects the CSOC bootstrap did not write, so it is left alone"
}

func liveEnvironments(envs []*Environment) []string {
	var live []string
	for _, e := range envs {
		running := e.LastRun != nil && e.LastRun.Status == RunRunning
		switch {
		case running:
			live = append(live, e.Name+" (a run is in progress)")
		case e.Status != StatusNew && e.Status != StatusPlanned && e.Status != StatusDestroyed:
			live = append(live, fmt.Sprintf("%s (%s)", e.Name, e.Status))
		}
	}
	return live
}

// deleteStateBucket empties the bucket of every version and delete marker,
// then deletes it.
func deleteStateBucket(ctx context.Context, api bucketTeardownAPI, bucket string) (int, error) {
	envs, err := NewStore(api, bucket).List(ctx)
	if err != nil {
		return 0, err
	}
	if live := liveEnvironments(envs); len(live) > 0 {
		return 0, &BucketBlocked{Environments: live}
	}

	var objects []s3types.ObjectIdentifier
	blocked := &BucketBlocked{}
	in := &s3.ListObjectVersionsInput{Bucket: &bucket}
	for {
		out, err := api.ListObjectVersions(ctx, in)
		if err != nil {
			return 0, err
		}
		add := func(key, version *string) {
			if !strings.HasPrefix(awssdk.ToString(key), bootstrapRoot) {
				blocked.Foreign = append(blocked.Foreign, awssdk.ToString(key))
			}
			objects = append(objects, s3types.ObjectIdentifier{Key: key, VersionId: version})
		}
		for _, v := range out.Versions {
			add(v.Key, v.VersionId)
		}
		for _, m := range out.DeleteMarkers {
			add(m.Key, m.VersionId)
		}
		if !awssdk.ToBool(out.IsTruncated) {
			break
		}
		in.KeyMarker, in.VersionIdMarker = out.NextKeyMarker, out.NextVersionIdMarker
	}
	if len(blocked.Foreign) > 0 {
		if len(blocked.Foreign) > 10 {
			blocked.Foreign = append(blocked.Foreign[:10], "…")
		}
		return 0, blocked
	}

	for i := 0; i < len(objects); i += 1000 {
		batch := objects[i:min(i+1000, len(objects))]
		out, err := api.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: &bucket, Delete: &s3types.Delete{Objects: batch, Quiet: awssdk.Bool(true)},
		})
		if err != nil {
			return 0, err
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return 0, fmt.Errorf("delete %s: %s", awssdk.ToString(e.Key), awssdk.ToString(e.Message))
		}
	}
	if _, err := api.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: &bucket}); err != nil {
		return 0, err
	}
	return len(objects), nil
}

// POST /api/environments/delete-bucket  {bucket, confirm, ...target}
func HandleDeleteBucket(c *gin.Context) {
	var r struct {
		request
		Confirm string `json:"confirm"`
	}
	if !bind(c, &r) {
		return
	}
	bucket := r.bucket()
	if !validBucket.MatchString(bucket) || r.Confirm != bucket {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type the bucket name to confirm"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()
	cfg, err := awslookup.LoadConfig(ctx, r.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, awslookup.ErrorBody(r.Profile, err))
		return
	}
	n, err := deleteStateBucket(ctx, s3.NewFromConfig(cfg), bucket)
	if blocked, ok := err.(*BucketBlocked); ok {
		c.JSON(http.StatusConflict, gin.H{"error": blocked.Error(), "environments": blocked.Environments, "foreign": blocked.Foreign})
		return
	}
	if err != nil {
		fail(c, &r.request, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bucket": bucket, "deleted": true, "objects": n})
}
