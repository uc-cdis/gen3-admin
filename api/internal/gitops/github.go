// Package gitops writes CSOC and Gen3 configuration into a GitOps repo, which
// each cluster's ArgoCD deploys from. Every change goes in as a pull request,
// opened by a GitHub App, so nothing reaches a cluster without a review.
//
// The repo only ever holds configuration. Secrets live in AWS Secrets Manager
// and reach the clusters through External Secrets Operator; the files here
// name them and never contain them, which Guard enforces before any commit.
package gitops

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AppCredentials identify a GitHub App installation. The private key is the
// only secret; it is read from Secrets Manager for each use and never stored
// anywhere else by CSOC.
type AppCredentials struct {
	AppID          int64
	InstallationID int64
	PrivateKey     []byte
}

// Repo is the GitOps repository, e.g. github.com/<owner>/<name>.
type Repo struct {
	Owner      string `json:"owner"`
	Name       string `json:"name"`
	BaseBranch string `json:"base_branch,omitempty"`
}

var validRepoPart = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)
var validBranch = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,200}$`)

func (r Repo) Validate() error {
	if !validRepoPart.MatchString(r.Owner) || !validRepoPart.MatchString(r.Name) ||
		r.Owner == "." || r.Owner == ".." || r.Name == "." || r.Name == ".." {
		return errors.New("repo must be <owner>/<name>")
	}
	if r.BaseBranch != "" && (!validBranch.MatchString(r.BaseBranch) || strings.Contains(r.BaseBranch, "..")) {
		return errors.New("base branch is not a valid branch name")
	}
	return nil
}

// CloneURL is the HTTPS URL ArgoCD pulls from.
func (r Repo) CloneURL() string {
	return "https://github.com/" + r.Owner + "/" + r.Name + ".git"
}

// apiBase is GitHub's REST API, or GITHUB_API_URL for GitHub Enterprise.
func apiBase() string {
	if v := strings.TrimRight(os.Getenv("GITHUB_API_URL"), "/"); v != "" {
		return v
	}
	return "https://api.github.com"
}

// Client talks to one repo as one App installation. Its token is scoped to
// that repo only, with just the permissions a PR needs.
type Client struct {
	http  *http.Client
	base  string
	repo  Repo
	token string
}

// Permissions the installation token is limited to. GitHub refuses the token
// if the App was not granted them, which is how Connect tells the operator
// the App is misconfigured.
var tokenPermissions = map[string]string{
	"contents":      "write",
	"pull_requests": "write",
	"metadata":      "read",
}

// NewClient exchanges the App's key for an installation token scoped to repo.
func NewClient(ctx context.Context, creds AppCredentials, repo Repo) (*Client, error) {
	if err := repo.Validate(); err != nil {
		return nil, err
	}
	c := &Client{http: &http.Client{Timeout: 30 * time.Second}, base: apiBase(), repo: repo}
	appJWT, err := appToken(creds, time.Now())
	if err != nil {
		return nil, err
	}
	var out struct {
		Token string `json:"token"`
	}
	body := map[string]any{"repositories": []string{repo.Name}, "permissions": tokenPermissions}
	path := fmt.Sprintf("/app/installations/%d/access_tokens", creds.InstallationID)
	if err := c.do(ctx, http.MethodPost, path, "Bearer "+appJWT, body, &out); err != nil {
		return nil, fmt.Errorf("get installation token: %w", err)
	}
	if out.Token == "" {
		return nil, errors.New("github returned no installation token")
	}
	c.token = out.Token
	return c, nil
}

// appToken is the short-lived JWT that authenticates as the App itself.
func appToken(creds AppCredentials, now time.Time) (string, error) {
	if creds.AppID <= 0 || creds.InstallationID <= 0 {
		return "", errors.New("github app id and installation id are required")
	}
	key, err := parseKey(creds.PrivateKey)
	if err != nil {
		return "", err
	}
	claims := jwt.RegisteredClaims{
		// Backdated against clock skew, as GitHub recommends.
		IssuedAt:  jwt.NewNumericDate(now.Add(-60 * time.Second)),
		ExpiresAt: jwt.NewNumericDate(now.Add(9 * time.Minute)),
		Issuer:    strconv.FormatInt(creds.AppID, 10),
	}
	return jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
}

func parseKey(pem []byte) (*rsa.PrivateKey, error) {
	key, err := jwt.ParseRSAPrivateKeyFromPEM(pem)
	if err != nil {
		return nil, errors.New("github app private key is not an RSA PEM key")
	}
	return key, nil
}

// APIError is a non-2xx answer from GitHub.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("github: %d %s", e.Status, e.Message)
}

func IsNotFound(err error) bool {
	var e *APIError
	return errors.As(err, &e) && e.Status == http.StatusNotFound
}

func (c *Client) do(ctx context.Context, method, path, auth string, in, out any) error {
	var body io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if auth == "" {
		auth = "Bearer " + c.token
	}
	req.Header.Set("Authorization", auth)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var msg struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &msg)
		if msg.Message == "" {
			msg.Message = http.StatusText(resp.StatusCode)
		}
		return &APIError{Status: resp.StatusCode, Message: msg.Message}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func (c *Client) repoPath(format string, args ...any) string {
	return "/repos/" + url.PathEscape(c.repo.Owner) + "/" + url.PathEscape(c.repo.Name) + fmt.Sprintf(format, args...)
}

// RepoInfo is what Connect reports back about the repo.
type RepoInfo struct {
	FullName      string `json:"full_name"`
	DefaultBranch string `json:"default_branch"`
	Private       bool   `json:"private"`
	HTMLURL       string `json:"html_url"`
}

// Repo checks the installation can see the repo.
func (c *Client) RepoInfo(ctx context.Context) (*RepoInfo, error) {
	var info RepoInfo
	if err := c.do(ctx, http.MethodGet, c.repoPath(""), "", nil, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (c *Client) baseBranch(ctx context.Context) (string, error) {
	if c.repo.BaseBranch != "" {
		return c.repo.BaseBranch, nil
	}
	info, err := c.RepoInfo(ctx)
	if err != nil {
		return "", err
	}
	return info.DefaultBranch, nil
}

// File is one file of a change. A nil Content deletes the path.
type File struct {
	Path    string
	Content []byte
}

// Change is one pull request.
type Change struct {
	Branch string
	Title  string
	Body   string
	Files  []File
	// Prune deletes every existing file under this directory that is not in
	// Files, so a re-render does not leave stale manifests behind for ArgoCD.
	Prune string
}

// PullRequest is the state the wizard and the environment record track.
type PullRequest struct {
	Number    int    `json:"number"`
	URL       string `json:"url"`
	Branch    string `json:"branch"`
	State     string `json:"state"`
	Merged    bool   `json:"merged"`
	MergeSHA  string `json:"merge_sha,omitempty"`
	HeadSHA   string `json:"head_sha,omitempty"`
	NoChanges bool   `json:"no_changes,omitempty"`
}

type gitRef struct {
	Object struct {
		SHA string `json:"sha"`
	} `json:"object"`
}

// treeEntry is one entry of a create-tree request. GitHub deletes a path when
// its entry has an explicit "sha": null, so that key cannot be omitempty.
type treeEntry map[string]any

func blobEntry(path string, content []byte) treeEntry {
	return treeEntry{"path": path, "mode": "100644", "type": "blob", "content": string(content)}
}

func deleteEntry(path string) treeEntry {
	return treeEntry{"path": path, "mode": "100644", "type": "blob", "sha": nil}
}

// OpenPR commits the change on a new branch off the base branch and opens a
// pull request for it. If the change would not alter the base branch, no PR
// is opened and NoChanges is set.
func (c *Client) OpenPR(ctx context.Context, ch Change) (*PullRequest, error) {
	if !validBranch.MatchString(ch.Branch) || strings.Contains(ch.Branch, "..") {
		return nil, errors.New("invalid branch name")
	}
	for _, f := range ch.Files {
		if err := checkPath(f.Path); err != nil {
			return nil, err
		}
		if f.Content != nil {
			if err := Guard(f.Path, f.Content); err != nil {
				return nil, err
			}
		}
	}
	base, err := c.baseBranch(ctx)
	if err != nil {
		return nil, err
	}
	var ref gitRef
	if err := c.do(ctx, http.MethodGet, c.repoPath("/git/ref/heads/%s", base), "", nil, &ref); err != nil {
		return nil, fmt.Errorf("read base branch %s: %w", base, err)
	}
	var baseCommit struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if err := c.do(ctx, http.MethodGet, c.repoPath("/git/commits/%s", ref.Object.SHA), "", nil, &baseCommit); err != nil {
		return nil, err
	}

	entries, err := c.treeEntries(ctx, baseCommit.Tree.SHA, ch)
	if err != nil {
		return nil, err
	}
	var tree struct {
		SHA string `json:"sha"`
	}
	if err := c.do(ctx, http.MethodPost, c.repoPath("/git/trees"), "",
		map[string]any{"base_tree": baseCommit.Tree.SHA, "tree": entries}, &tree); err != nil {
		return nil, fmt.Errorf("create tree: %w", err)
	}
	if tree.SHA == baseCommit.Tree.SHA {
		return &PullRequest{NoChanges: true}, nil
	}

	var commit struct {
		SHA string `json:"sha"`
	}
	if err := c.do(ctx, http.MethodPost, c.repoPath("/git/commits"), "",
		map[string]any{"message": ch.Title + "\n\n" + ch.Body, "tree": tree.SHA, "parents": []string{ref.Object.SHA}}, &commit); err != nil {
		return nil, fmt.Errorf("create commit: %w", err)
	}
	if err := c.do(ctx, http.MethodPost, c.repoPath("/git/refs"), "",
		map[string]any{"ref": "refs/heads/" + ch.Branch, "sha": commit.SHA}, nil); err != nil {
		return nil, fmt.Errorf("create branch %s: %w", ch.Branch, err)
	}
	var pr struct {
		Number  int    `json:"number"`
		HTMLURL string `json:"html_url"`
		State   string `json:"state"`
	}
	if err := c.do(ctx, http.MethodPost, c.repoPath("/pulls"), "",
		map[string]any{"title": ch.Title, "body": ch.Body, "head": ch.Branch, "base": base}, &pr); err != nil {
		return nil, fmt.Errorf("open pull request: %w", err)
	}
	return &PullRequest{Number: pr.Number, URL: pr.HTMLURL, Branch: ch.Branch, State: pr.State, HeadSHA: commit.SHA}, nil
}

// treeEntries turns the change into tree entries against the base tree:
// inline content for each file, and a null SHA for each deletion.
func (c *Client) treeEntries(ctx context.Context, baseTree string, ch Change) ([]treeEntry, error) {
	keep := map[string]bool{}
	var entries []treeEntry
	for _, f := range ch.Files {
		keep[f.Path] = true
		if f.Content == nil {
			entries = append(entries, deleteEntry(f.Path))
		} else {
			entries = append(entries, blobEntry(f.Path, f.Content))
		}
	}
	if ch.Prune != "" {
		existing, err := c.listTree(ctx, baseTree)
		if err != nil {
			return nil, err
		}
		prefix := strings.TrimSuffix(ch.Prune, "/") + "/"
		for _, p := range existing {
			if strings.HasPrefix(p, prefix) && !keep[p] {
				entries = append(entries, deleteEntry(p))
			}
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i]["path"].(string) < entries[j]["path"].(string) })
	return entries, nil
}

func (c *Client) listTree(ctx context.Context, sha string) ([]string, error) {
	var tree struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
		Truncated bool `json:"truncated"`
	}
	if err := c.do(ctx, http.MethodGet, c.repoPath("/git/trees/%s?recursive=1", sha), "", nil, &tree); err != nil {
		return nil, err
	}
	if tree.Truncated {
		return nil, errors.New("repo tree is too large to prune; remove stale files by hand")
	}
	var paths []string
	for _, t := range tree.Tree {
		if t.Type == "blob" {
			paths = append(paths, t.Path)
		}
	}
	return paths, nil
}

// GetPR reads a pull request's current state.
func (c *Client) GetPR(ctx context.Context, number int) (*PullRequest, error) {
	var pr struct {
		Number         int    `json:"number"`
		HTMLURL        string `json:"html_url"`
		State          string `json:"state"`
		Merged         bool   `json:"merged"`
		MergeCommitSHA string `json:"merge_commit_sha"`
		Head           struct {
			Ref string `json:"ref"`
			SHA string `json:"sha"`
		} `json:"head"`
	}
	if err := c.do(ctx, http.MethodGet, c.repoPath("/pulls/%d", number), "", nil, &pr); err != nil {
		return nil, err
	}
	out := &PullRequest{Number: pr.Number, URL: pr.HTMLURL, Branch: pr.Head.Ref, State: pr.State, Merged: pr.Merged, HeadSHA: pr.Head.SHA}
	if pr.Merged {
		out.MergeSHA = pr.MergeCommitSHA
	}
	return out, nil
}

// checkPath keeps every write a plain relative path inside the repo.
func checkPath(p string) error {
	if p == "" || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") {
		return fmt.Errorf("invalid repo path %q", p)
	}
	for _, part := range strings.Split(p, "/") {
		if part == "" || part == "." || part == ".." || part == ".git" {
			return fmt.Errorf("invalid repo path %q", p)
		}
	}
	return nil
}
