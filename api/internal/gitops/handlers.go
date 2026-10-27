package gitops

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/gin-gonic/gin"

	awslookup "github.com/uc-cdis/gen3-admin/internal/aws"
	"github.com/uc-cdis/gen3-admin/internal/environments"
)

// request is the common body: the registry bucket, the identity to act as,
// and the environment. As with /api/environments, in-cluster CSOC may leave
// the bucket and identity out.
type request struct {
	awslookup.Target
	Bucket      string `json:"bucket"`
	Environment string `json:"environment"`
}

func (r *request) bucket() string {
	if r.Bucket != "" {
		return r.Bucket
	}
	return os.Getenv("CSOC_STATE_BUCKET")
}

// session is one request's view of an environment: its record, and clients
// for the registry and its region's Secrets Manager, all as the caller.
type session struct {
	ctx     context.Context
	store   *environments.Store
	secrets SecretsAPI
	env     *environments.Environment
	bucket  string
}

func open(c *gin.Context, r *request) (*session, context.CancelFunc, bool) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	fail := func(status int, err error) (*session, context.CancelFunc, bool) {
		cancel()
		c.JSON(status, gin.H{"error": err.Error()})
		return nil, nil, false
	}
	if !environments.ValidName(r.Environment) {
		return fail(http.StatusBadRequest, errors.New("a valid environment name is required"))
	}
	store, err := environments.OpenStore(ctx, r.bucket(), r.Target)
	if err != nil {
		return fail(http.StatusBadRequest, err)
	}
	e, err := store.Get(ctx, r.Environment)
	if errors.Is(err, environments.ErrNotFound) {
		return fail(http.StatusNotFound, fmt.Errorf("environment %s is not registered", r.Environment))
	}
	if err != nil {
		return fail(http.StatusBadGateway, err)
	}
	// Secrets Manager is regional; the CSOC's secrets are in its region.
	target := r.Target
	if e.Region != "" {
		target.Region = e.Region
	}
	cfg, err := awslookup.LoadConfig(ctx, target)
	if err != nil {
		return fail(http.StatusBadRequest, err)
	}
	return &session{ctx: ctx, store: store, secrets: secretsmanager.NewFromConfig(cfg), env: e, bucket: r.bucket()}, cancel, true
}

func (s *session) client() (*Client, error) {
	repo, err := RepoOf(s.env)
	if err != nil {
		return nil, err
	}
	creds, err := GetAppCredentials(s.ctx, s.secrets, s.env.GitOps.KeySecret)
	if err != nil {
		return nil, err
	}
	return NewClient(s.ctx, creds, repo)
}

// githubError turns a GitHub failure into an answer that says what to fix.
func githubError(c *gin.Context, err error) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		msg := apiErr.Message
		switch apiErr.Status {
		case http.StatusUnauthorized:
			msg = "GitHub rejected the App credentials; check the App ID and private key"
		case http.StatusForbidden, http.StatusUnprocessableEntity:
			if strings.Contains(strings.ToLower(msg), "permission") {
				msg = "the GitHub App needs Contents and Pull requests read & write on this repo: " + msg
			}
		case http.StatusNotFound:
			msg = "GitHub could not find it; check the installation ID, and that the App is installed on the repo"
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": msg, "github_status": apiErr.Status})
		return
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
}

var validGitHubAppKey = regexp.MustCompile(`^-----BEGIN (RSA )?PRIVATE KEY-----`)

// POST /api/gitops/connect
//
//	{bucket, environment, owner, repo, base_branch?, app_id, installation_id,
//	 private_key, ...target}
//
// Checks the App can reach the repo, stores its key in Secrets Manager under
// the CSOC's prefix, and records the repo on the environment. The key is not
// written anywhere else, and is not returned.
func HandleConnect(c *gin.Context) {
	var r struct {
		request
		Owner          string `json:"owner"`
		Repo           string `json:"repo"`
		BaseBranch     string `json:"base_branch"`
		AppID          int64  `json:"app_id"`
		InstallationID int64  `json:"installation_id"`
		PrivateKey     string `json:"private_key"`
	}
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	repo := Repo{Owner: r.Owner, Name: r.Repo, BaseBranch: r.BaseBranch}
	if err := repo.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	key := strings.TrimSpace(r.PrivateKey) + "\n"
	if !validGitHubAppKey.MatchString(key) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paste the App's private key (.pem), starting with -----BEGIN"})
		return
	}
	s, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	if s.env.Kind != environments.KindCSOC {
		c.JSON(http.StatusBadRequest, gin.H{"error": "connect the repo on the CSOC; a commons uses its CSOC's repo"})
		return
	}

	creds := AppCredentials{AppID: r.AppID, InstallationID: r.InstallationID, PrivateKey: []byte(key)}
	client, err := NewClient(s.ctx, creds, repo)
	if err != nil {
		githubError(c, err)
		return
	}
	info, err := client.RepoInfo(s.ctx)
	if err != nil {
		githubError(c, err)
		return
	}
	if repo.BaseBranch == "" {
		repo.BaseBranch = info.DefaultBranch
	}

	secretName := SecretName(s.env.Name, SecretGitHubApp)
	if err := PutAppCredentials(s.ctx, s.secrets, secretName, s.env.Name, creds); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "store the App key in Secrets Manager: " + awsMessage(err)})
		return
	}
	e, err := s.store.Update(s.ctx, s.env.Name, func(e *environments.Environment) {
		prev := e.GitOps
		e.GitOps = &environments.GitOps{
			Owner: repo.Owner, Repo: repo.Name, BaseBranch: repo.BaseBranch,
			AppID: r.AppID, InstallationID: r.InstallationID, KeySecret: secretName,
		}
		// Reconnecting the same repo keeps track of its open PR.
		if prev != nil && prev.Owner == repo.Owner && prev.Repo == repo.Name {
			e.GitOps.PullRequest = prev.PullRequest
		}
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"gitops": e.GitOps, "repo": info})
}

// POST /api/gitops/status  {bucket, environment, ...target}
//
// The environment's repo and its latest PR, refreshed from GitHub while the
// PR is open. A merge is recorded on the environment.
func HandleStatus(c *gin.Context) {
	var r request
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	s, cancel, ok := open(c, &r)
	if !ok {
		return
	}
	defer cancel()
	g := s.env.GitOps
	if g == nil {
		c.JSON(http.StatusOK, gin.H{"connected": false})
		return
	}
	if pr := g.PullRequest; pr != nil && pr.State == "open" {
		client, err := s.client()
		if err != nil {
			githubError(c, err)
			return
		}
		live, err := client.GetPR(s.ctx, pr.Number)
		if err != nil {
			githubError(c, err)
			return
		}
		if live.State != pr.State || live.Merged != pr.Merged {
			e, err := s.store.Update(s.ctx, s.env.Name, func(e *environments.Environment) {
				if e.GitOps == nil || e.GitOps.PullRequest == nil || e.GitOps.PullRequest.Number != live.Number {
					return
				}
				p := e.GitOps.PullRequest
				p.State, p.Merged, p.MergeSHA = live.State, live.Merged, live.MergeSHA
				if live.Merged {
					now := time.Now().UTC()
					p.MergedAt = &now
				}
			})
			if err != nil {
				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
				return
			}
			g = e.GitOps
		}
	}
	c.JSON(http.StatusOK, gin.H{"connected": true, "gitops": g})
}

// POST /api/gitops/propose-csoc  {bucket, environment, allowed_cidrs?, ...target}
//
// Renders the CSOC's directory and opens a PR with it. allowed_cidrs, when
// given, replaces the operator part of the allowlist (the cluster's egress
// IP is always kept), which is how the allowlist is managed after install.
func HandleProposeCSOC(c *gin.Context) {
	var r struct {
		request
		AllowedCIDRs []string `json:"allowed_cidrs"`
	}
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	s, cancel, ok := open(c, &r.request)
	if !ok {
		return
	}
	defer cancel()
	switch s.env.Status {
	case environments.StatusBootstrapped, environments.StatusInstalled:
	default:
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("environment %s is %s; run install-csoc first", s.env.Name, s.env.Status)})
		return
	}
	if s.env.Install.Direct() || s.env.GitOps == nil {
		// Its cluster has no ArgoCD to deploy a merged PR.
		c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("environment %s was installed without GitOps; moving it to GitOps is not supported yet", s.env.Name)})
		return
	}
	if pr := prOpen(s.env); pr != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "PR #" + fmt.Sprint(pr.Number) + " is still open; merge or close it first", "pull_request": pr})
		return
	}
	if r.AllowedCIDRs != nil {
		cidrs, err := NormalizeCIDRs(r.AllowedCIDRs)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if s.env.Install == nil {
			s.env.Install = &environments.Install{}
		}
		s.env.Install.AllowedCIDRs = cidrs
	}
	in, err := CSOCInputsFor(s.env, s.bucket)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rendered, err := RenderCSOC(in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	client, err := s.client()
	if err != nil {
		githubError(c, err)
		return
	}
	pr, err := client.OpenPR(s.ctx, Change{
		Branch: fmt.Sprintf("gen3-csoc/%s-%s", s.env.Name, time.Now().UTC().Format("20060102-150405")),
		Title:  "CSOC " + s.env.Name + ": update configuration",
		Body:   prBody(c, s.env, in),
		Files:  rendered.Files,
		Prune:  rendered.Dir,
	})
	if err != nil {
		githubError(c, err)
		return
	}
	e, err := s.store.Update(s.ctx, s.env.Name, func(e *environments.Environment) {
		if r.AllowedCIDRs != nil && e.Install != nil {
			e.Install.AllowedCIDRs = s.env.Install.AllowedCIDRs
		}
		if !pr.NoChanges && e.GitOps != nil {
			e.GitOps.PullRequest = &environments.PullRequest{
				Number: pr.Number, URL: pr.URL, Branch: pr.Branch, State: pr.State, OpenedAt: time.Now().UTC(),
			}
		}
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"no_changes": pr.NoChanges, "gitops": e.GitOps})
}

func prOpen(e *environments.Environment) *environments.PullRequest {
	if e.GitOps != nil && e.GitOps.PullRequest != nil && e.GitOps.PullRequest.State == "open" {
		return e.GitOps.PullRequest
	}
	return nil
}

func prBody(c *gin.Context, e *environments.Environment, in CSOCInputs) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Rendered by CSOC for environment `%s`", e.Name)
	if who := requester(c); who != "" {
		fmt.Fprintf(&b, ", requested by %s", who)
	}
	b.WriteString(".\n\nArgoCD on the CSOC cluster applies this once it is merged.\n\n")
	b.WriteString("**Allowlist** (the ALB and the agent NLB accept only these):\n\n")
	for _, cidr := range in.AllowedCIDRs {
		fmt.Fprintf(&b, "- `%s`\n", cidr)
	}
	fmt.Fprintf(&b, "\n**Secrets** stay in AWS Secrets Manager under `%s` (%s); these files only name them.\n",
		SecretPrefix(e.Name), in.Region)
	return b.String()
}

// requester names the signed-in user for the PR body.
func requester(c *gin.Context) string {
	v, ok := c.Get("userInfo")
	if !ok {
		return ""
	}
	var m map[string]any
	switch info := v.(type) {
	case gin.H:
		m = info
	case map[string]any:
		m = info
	default:
		return ""
	}
	for _, k := range []string{"email", "preferred_username", "name"} {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func awsMessage(err error) string {
	msg := err.Error()
	if i := strings.LastIndex(msg, "api error "); i >= 0 {
		return msg[i+len("api error "):]
	}
	return msg
}

func RegisterRoutes(r gin.IRouter) {
	r.POST("/api/gitops/connect", HandleConnect)
	r.POST("/api/gitops/status", HandleStatus)
	r.POST("/api/gitops/propose-csoc", HandleProposeCSOC)
}
