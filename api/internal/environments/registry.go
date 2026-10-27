// Package environments keeps a record of every environment CSOC has
// provisioned -- the CSOC itself and each Gen3 commons -- and of every
// Terraform run against them.
//
// The record lives in the Terraform state bucket, next to the state it
// describes, rather than in a database or on local disk. That is what lets a
// CSOC bootstrapped from a laptop pick up the laptop's history once it is
// running in its own cluster: both read the same bucket.
//
//	gen3-csoc/environments/<name>/environment.json
//	gen3-csoc/environments/<name>/terraform.tfstate
//	gen3-csoc/environments/<name>/runs/<id>.json
//	gen3-csoc/environments/<name>/runs/<id>.log
package environments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const Prefix = "gen3-csoc/environments/"

type Kind string

const (
	KindCSOC    Kind = "csoc"
	KindCommons Kind = "commons"
)

// Status is where an environment stands after its most recent run.
type Status string

const (
	StatusNew         Status = "new"
	StatusInitialized Status = "initialized"
	StatusPlanned     Status = "planned"
	StatusApplying    Status = "applying"
	StatusApplied     Status = "applied"
	// StatusBootstrapped: ArgoCD and ESO are on the cluster, and the
	// configuration PR is waiting to be merged.
	StatusBootstrapped Status = "bootstrapped"
	StatusInstalled    Status = "installed"
	StatusDestroying   Status = "destroying"
	StatusDestroyed    Status = "destroyed"
	StatusFailed       Status = "failed"
)

type Environment struct {
	Name   string `json:"name"`
	Kind   Kind   `json:"kind"`
	Module string `json:"module"`
	Region string `json:"region"`
	// StateKey is derived from Name; it is stored so a reader does not need
	// to know the convention.
	StateKey string `json:"state_key"`
	// Parent is the CSOC that manages a commons.
	Parent string `json:"parent,omitempty"`
	// Tfvars is the configuration the environment was last planned with.
	Tfvars string `json:"tfvars,omitempty"`
	// Config is the wizard's form state, kept so a half-finished setup can
	// be resumed with the form filled in. Never credentials.
	Config json.RawMessage `json:"config,omitempty"`
	// Outputs holds the non-sensitive Terraform outputs from the last apply.
	Outputs map[string]json.RawMessage `json:"outputs,omitempty"`
	// GitOps is the repo the environment's configuration is kept in. For a
	// commons it is inherited from Parent.
	GitOps *GitOps `json:"gitops,omitempty"`
	// Install is what the CSOC install was run with, minus the admin
	// password, so the repo can be re-rendered without asking again.
	Install *Install `json:"install,omitempty"`

	Status    Status    `json:"status"`
	LastRun   *Run      `json:"last_run,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GitOps identifies the repo and the GitHub App installation that writes to
// it. The App's private key is not here: it is in Secrets Manager.
type GitOps struct {
	Owner          string `json:"owner"`
	Repo           string `json:"repo"`
	BaseBranch     string `json:"base_branch"`
	AppID          int64  `json:"app_id"`
	InstallationID int64  `json:"installation_id"`
	// KeySecret is the Secrets Manager secret holding the App's key.
	KeySecret string `json:"key_secret"`
	// PullRequest is the most recent configuration PR.
	PullRequest *PullRequest `json:"pull_request,omitempty"`
}

type PullRequest struct {
	Number   int        `json:"number"`
	URL      string     `json:"url"`
	Branch   string     `json:"branch"`
	State    string     `json:"state"`
	Merged   bool       `json:"merged"`
	MergeSHA string     `json:"merge_sha,omitempty"`
	OpenedAt time.Time  `json:"opened_at"`
	MergedAt *time.Time `json:"merged_at,omitempty"`
}

type Install struct {
	// Mode is how the CSOC was installed: InstallGitOps, or InstallDirect
	// when it has no repo and the install applied everything itself.
	Mode          string   `json:"mode,omitempty"`
	AllowedCIDRs  []string `json:"allowed_cidrs"`
	AdminEmail    string   `json:"admin_email,omitempty"`
	APIImage      string   `json:"api_image,omitempty"`
	FrontendImage string   `json:"frontend_image,omitempty"`
	// EgressIP is the cluster's outbound address, which the install found
	// and the allowlist always includes.
	EgressIP string `json:"egress_ip,omitempty"`
}

const (
	InstallGitOps = "gitops"
	InstallDirect = "direct"
)

// Direct reports whether the environment was installed without GitOps.
func (i *Install) Direct() bool { return i != nil && i.Mode == InstallDirect }

type RunStatus string

const (
	RunRunning   RunStatus = "running"
	RunSucceeded RunStatus = "succeeded"
	RunFailed    RunStatus = "failed"
)

type PlanSummary struct {
	Add     int `json:"add"`
	Change  int `json:"change"`
	Destroy int `json:"destroy"`
}

type Run struct {
	ID        string       `json:"id"`
	Operation string       `json:"operation"`
	Status    RunStatus    `json:"status"`
	ExitCode  *int         `json:"exit_code,omitempty"`
	Plan      *PlanSummary `json:"plan,omitempty"`
	// Where the run happened, so the in-cluster CSOC can tell its own runs
	// from the ones made during bootstrap.
	Runner    string     `json:"runner,omitempty"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
}

var validName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)

func ValidName(name string) bool { return validName.MatchString(name) }

// StateKey is the S3 key an environment's Terraform state is kept under.
func StateKey(name string) string { return Prefix + name + "/terraform.tfstate" }

// S3API is the part of the S3 client the registry uses.
type S3API interface {
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
}

type Store struct {
	api    S3API
	bucket string
}

func NewStore(api S3API, bucket string) *Store { return &Store{api: api, bucket: bucket} }

var ErrNotFound = errors.New("not found")

func (s *Store) envKey(name string) string { return Prefix + name + "/environment.json" }
func (s *Store) runKey(name, id string) string {
	return Prefix + name + "/runs/" + id + ".json"
}
func (s *Store) logKey(name, id string) string {
	return Prefix + name + "/runs/" + id + ".log"
}

func (s *Store) put(ctx context.Context, key, contentType string, body []byte) error {
	_, err := s.api.PutObject(ctx, &s3.PutObjectInput{
		Bucket:               &s.bucket,
		Key:                  &key,
		Body:                 bytes.NewReader(body),
		ContentType:          &contentType,
		ServerSideEncryption: s3types.ServerSideEncryptionAes256,
	})
	return err
}

func (s *Store) get(ctx context.Context, key string) ([]byte, error) {
	out, err := s.api.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		var nsk *s3types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

func (s *Store) getJSON(ctx context.Context, key string, into any) error {
	b, err := s.get(ctx, key)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, into)
}

func (s *Store) putJSON(ctx context.Context, key string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return s.put(ctx, key, "application/json", b)
}

func (s *Store) Get(ctx context.Context, name string) (*Environment, error) {
	if !ValidName(name) {
		return nil, fmt.Errorf("invalid environment name")
	}
	var e Environment
	if err := s.getJSON(ctx, s.envKey(name), &e); err != nil {
		return nil, err
	}
	return &e, nil
}

// Save writes an environment, keeping its creation time, status, last run,
// outputs, GitOps repo and install settings when it already exists: the
// wizard saves its form state, but only runs and the GitOps calls move the
// rest.
func (s *Store) Save(ctx context.Context, e *Environment) (*Environment, error) {
	if !ValidName(e.Name) {
		return nil, fmt.Errorf("environment name must match %s", validName)
	}
	if e.Kind != KindCSOC && e.Kind != KindCommons {
		return nil, fmt.Errorf("kind must be %q or %q", KindCSOC, KindCommons)
	}
	now := time.Now().UTC()
	e.StateKey = StateKey(e.Name)
	e.UpdatedAt = now

	prev, err := s.Get(ctx, e.Name)
	switch {
	case err == nil:
		e.CreatedAt, e.Status, e.LastRun = prev.CreatedAt, prev.Status, prev.LastRun
		e.GitOps, e.Install = prev.GitOps, prev.Install
		if e.Outputs == nil {
			e.Outputs = prev.Outputs
		}
	case errors.Is(err, ErrNotFound):
		e.CreatedAt, e.Status = now, StatusNew
	default:
		return nil, err
	}
	return e, s.putJSON(ctx, s.envKey(e.Name), e)
}

// Update applies fn to the stored environment and writes it back.
func (s *Store) Update(ctx context.Context, name string, fn func(*Environment)) (*Environment, error) {
	e, err := s.Get(ctx, name)
	if err != nil {
		return nil, err
	}
	fn(e)
	e.UpdatedAt = time.Now().UTC()
	return e, s.putJSON(ctx, s.envKey(name), e)
}

func (s *Store) List(ctx context.Context) ([]*Environment, error) {
	var names []string
	in := &s3.ListObjectsV2Input{Bucket: &s.bucket, Prefix: awssdk.String(Prefix), Delimiter: awssdk.String("/")}
	for {
		out, err := s.api.ListObjectsV2(ctx, in)
		if err != nil {
			return nil, err
		}
		for _, p := range out.CommonPrefixes {
			name := strings.TrimSuffix(strings.TrimPrefix(awssdk.ToString(p.Prefix), Prefix), "/")
			if ValidName(name) {
				names = append(names, name)
			}
		}
		if !awssdk.ToBool(out.IsTruncated) {
			break
		}
		in.ContinuationToken = out.NextContinuationToken
	}

	envs := make([]*Environment, 0, len(names))
	for _, n := range names {
		e, err := s.Get(ctx, n)
		if errors.Is(err, ErrNotFound) {
			continue // state with no record, e.g. from before the registry
		}
		if err != nil {
			return nil, err
		}
		envs = append(envs, e)
	}
	sort.Slice(envs, func(i, j int) bool { return envs[i].Name < envs[j].Name })
	return envs, nil
}

func (s *Store) PutRun(ctx context.Context, env string, r *Run) error {
	return s.putJSON(ctx, s.runKey(env, r.ID), r)
}

func (s *Store) PutLog(ctx context.Context, env, id string, log []byte) error {
	return s.put(ctx, s.logKey(env, id), "text/plain; charset=utf-8", log)
}

func (s *Store) GetLog(ctx context.Context, env, id string) ([]byte, error) {
	if !ValidName(env) || !validRunID.MatchString(id) {
		return nil, fmt.Errorf("invalid environment or run id")
	}
	return s.get(ctx, s.logKey(env, id))
}

var validRunID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

// Runs lists an environment's runs, newest first.
func (s *Store) Runs(ctx context.Context, env string) ([]*Run, error) {
	if !ValidName(env) {
		return nil, fmt.Errorf("invalid environment name")
	}
	prefix := Prefix + env + "/runs/"
	in := &s3.ListObjectsV2Input{Bucket: &s.bucket, Prefix: &prefix}
	var runs []*Run
	for {
		out, err := s.api.ListObjectsV2(ctx, in)
		if err != nil {
			return nil, err
		}
		for _, o := range out.Contents {
			key := awssdk.ToString(o.Key)
			if !strings.HasSuffix(key, ".json") {
				continue
			}
			var r Run
			if err := s.getJSON(ctx, key, &r); err != nil {
				return nil, err
			}
			runs = append(runs, &r)
		}
		if !awssdk.ToBool(out.IsTruncated) {
			break
		}
		in.ContinuationToken = out.NextContinuationToken
	}
	sort.Slice(runs, func(i, j int) bool { return runs[i].StartedAt.After(runs[j].StartedAt) })
	return runs, nil
}

var planLine = regexp.MustCompile(`Plan: (\d+) to add, (\d+) to change, (\d+) to destroy`)

// ParsePlanSummary reads the resource counts from a plan's log. A plan with
// nothing to do prints "No changes." instead of a Plan: line.
func ParsePlanSummary(log []byte) *PlanSummary {
	log = StripANSI(log)
	if m := planLine.FindSubmatch(log); m != nil {
		var p PlanSummary
		fmt.Sscan(string(m[1]), &p.Add)
		fmt.Sscan(string(m[2]), &p.Change)
		fmt.Sscan(string(m[3]), &p.Destroy)
		return &p
	}
	if bytes.Contains(log, []byte("No changes.")) {
		return &PlanSummary{}
	}
	return nil
}

// PublicOutputs keeps the outputs that are safe to store and show, from
// `terraform output -json`. Sensitive ones (access keys, passwords) stay in
// the state and nowhere else.
func PublicOutputs(raw []byte) (map[string]json.RawMessage, error) {
	var all map[string]struct {
		Sensitive bool            `json:"sensitive"`
		Value     json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(raw, &all); err != nil {
		return nil, err
	}
	out := make(map[string]json.RawMessage, len(all))
	for k, v := range all {
		if !v.Sensitive {
			out[k] = v.Value
		}
	}
	return out, nil
}

// StatusAfter is the environment status a finished run leaves behind.
func StatusAfter(operation string, ok bool) Status {
	if !ok {
		return StatusFailed
	}
	switch operation {
	case "init":
		return StatusInitialized
	case "plan":
		return StatusPlanned
	case "apply":
		return StatusApplied
	case "destroy":
		return StatusDestroyed
	case "install-csoc":
		return StatusBootstrapped
	case "finish-csoc":
		return StatusInstalled
	case "uninstall-csoc":
		// The cluster is still there; what ran on it is gone.
		return StatusApplied
	}
	return ""
}

// StatusDuring is the status shown while a run is in progress, for the
// operations that change infrastructure.
func StatusDuring(operation string) Status {
	switch operation {
	case "apply", "install-csoc", "finish-csoc":
		return StatusApplying
	case "destroy", "uninstall-csoc":
		return StatusDestroying
	}
	return ""
}
