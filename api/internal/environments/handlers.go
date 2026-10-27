package environments

import (
	"context"
	"errors"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"

	awslookup "github.com/uc-cdis/gen3-admin/internal/aws"
)

var validBucket = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

// request is the common body: which bucket holds the registry, and the AWS
// identity to read it as. On a laptop both come from the wizard. In-cluster
// CSOC is configured with CSOC_STATE_BUCKET and reads it with its own
// (IRSA) identity, so the body may leave them out.
type request struct {
	awslookup.Target
	Bucket string `json:"bucket"`
}

func (r *request) bucket() string {
	if r.Bucket != "" {
		return r.Bucket
	}
	return os.Getenv("CSOC_STATE_BUCKET")
}

// OpenStore builds a registry store for a bucket, read as target.
func OpenStore(ctx context.Context, bucket string, target awslookup.Target) (*Store, error) {
	if !validBucket.MatchString(bucket) {
		return nil, errors.New("a valid state bucket is required")
	}
	cfg, err := awslookup.LoadConfig(ctx, target)
	if err != nil {
		return nil, err
	}
	return NewStore(s3.NewFromConfig(cfg), bucket), nil
}

func bind[T any](c *gin.Context, into *T) bool {
	if err := c.ShouldBindJSON(into); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return false
	}
	return true
}

func open(c *gin.Context, r *request) (*Store, context.Context, context.CancelFunc, bool) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	store, err := OpenStore(ctx, r.bucket(), r.Target)
	if err != nil {
		cancel()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return nil, nil, nil, false
	}
	return store, ctx, cancel, true
}

func fail(c *gin.Context, err error) {
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
}

// POST /api/environments/list  {bucket, profile | credentials | role_arn}
func HandleList(c *gin.Context) {
	var r request
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r)
	if !ok {
		return
	}
	defer cancel()
	envs, err := store.List(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bucket": r.bucket(), "environments": envs})
}

// POST /api/environments/get  {bucket, name, ...target}
func HandleGet(c *gin.Context) {
	var r struct {
		request
		Name string `json:"name"`
	}
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	e, err := store.Get(ctx, r.Name)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, e)
}

// POST /api/environments/save  {bucket, environment, ...target}
// Creates or updates the descriptive part of an environment. Status, last
// run and outputs are owned by runs, and the GitOps repo by /api/gitops, so
// none of them can be set here.
func HandleSave(c *gin.Context) {
	var r struct {
		request
		Environment Environment `json:"environment"`
	}
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	in := r.Environment
	in.Outputs, in.LastRun, in.Status, in.GitOps, in.Install = nil, nil, "", nil, nil
	e, err := store.Save(ctx, &in)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			fail(c, err)
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, e)
}

// POST /api/environments/runs  {bucket, name, ...target}
func HandleRuns(c *gin.Context) {
	var r struct {
		request
		Name string `json:"name"`
	}
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	runs, err := store.Runs(ctx, r.Name)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"runs": runs})
}

// POST /api/environments/log  {bucket, name, run_id, ...target}
func HandleLog(c *gin.Context) {
	var r struct {
		request
		Name  string `json:"name"`
		RunID string `json:"run_id"`
	}
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	b, err := store.GetLog(ctx, r.Name, r.RunID)
	if err != nil {
		fail(c, err)
		return
	}
	c.Data(http.StatusOK, "text/plain; charset=utf-8", b)
}

// HandlePlan returns what a plan run would change, grouped for review.
// POST /api/environments/plan  {bucket, name, run_id, profile | credentials}
func HandlePlan(c *gin.Context) {
	var r struct {
		request
		Name  string `json:"name"`
		RunID string `json:"run_id"`
	}
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	d, err := store.GetPlan(ctx, r.Name, r.RunID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// HandlePlanDiagram returns a plan run's architecture diagram.
// POST /api/environments/plan-diagram  {bucket, name, run_id, profile | credentials}
func HandlePlanDiagram(c *gin.Context) {
	var r struct {
		request
		Name  string `json:"name"`
		RunID string `json:"run_id"`
	}
	if !bind(c, &r) {
		return
	}
	store, ctx, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	g, err := store.GetDiagram(ctx, r.Name, r.RunID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}

func RegisterRoutes(r gin.IRouter) {
	r.POST("/api/environments/plan", HandlePlan)
	r.POST("/api/environments/plan-diagram", HandlePlanDiagram)
	r.POST("/api/environments/list", HandleList)
	r.POST("/api/environments/get", HandleGet)
	r.POST("/api/environments/save", HandleSave)
	r.POST("/api/environments/runs", HandleRuns)
	r.POST("/api/environments/log", HandleLog)
}
