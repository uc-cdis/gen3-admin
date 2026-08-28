package argocd

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Transport performs an HTTP request against the ArgoCD API. Abstracted so the
// same client works whether ArgoCD is reachable directly (API pod in the same
// cluster) or only through an agent's gRPC tunnel.
type Transport interface {
	Do(ctx context.Context, method, path string, query url.Values, body []byte, headers map[string]string) (status int, respBody []byte, err error)
}

// Client is an ArgoCD API client for one cluster.
type Client struct {
	transport Transport
	baseURL   string

	tokenMu  sync.RWMutex
	token    string
	tokenExp time.Time

	// Credentials used to mint a new token when the current one expires.
	credentials CredentialResolver

	versionOnce sync.Once
	version     *VersionInfo
}

func NewClient(transport Transport, baseURL string, creds CredentialResolver) *Client {
	return &Client{transport: transport, baseURL: strings.TrimRight(baseURL, "/"), credentials: creds}
}

// SetToken installs a pre-obtained token (e.g. from ARGOCD_AUTH_TOKEN), skipping
// the login exchange entirely.
func (c *Client) SetToken(token string, expiry time.Time) {
	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()
	c.token = token
	c.tokenExp = expiry
}

// do performs a request, attaching the bearer token and decoding into out.
//
// On a 401 it clears the cached token and retries once: ArgoCD session tokens
// expire, and the alternative is surfacing a spurious auth failure to the user.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, payload interface{}, out interface{}) error {
	var body []byte
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return newError(KindUpstream, 0, "failed to encode request body", err)
		}
		body = encoded
	}

	for attempt := 0; attempt < 2; attempt++ {
		token, err := c.ensureToken(ctx)
		if err != nil {
			return err
		}

		headers := map[string]string{
			"Accept": "application/json",
		}
		if body != nil {
			headers["Content-Type"] = "application/json"
		}
		if token != "" {
			// Deliberately not "Authorization": the agent strips that header to
			// avoid leaking the caller's Keycloak token. This one is injected
			// upstream-side.
			headers["X-Proxy-Authorization"] = "Bearer " + token
		}

		status, respBody, err := c.transport.Do(ctx, method, c.baseURL+path, query, body, headers)
		if err != nil {
			return classifyTransportError(status, respBody, err)
		}

		if status == http.StatusUnauthorized && attempt == 0 {
			log.Debug().Msg("argocd: token rejected, clearing cache and retrying once")
			c.tokenMu.Lock()
			c.token = ""
			c.tokenExp = time.Time{}
			c.tokenMu.Unlock()
			continue
		}

		if status >= 400 {
			return classifyHTTPError(status, respBody)
		}

		if out != nil && len(respBody) > 0 {
			if err := json.Unmarshal(respBody, out); err != nil {
				return newError(KindUpstream, status, "failed to decode ArgoCD response", err)
			}
		}
		return nil
	}

	return newError(KindUnauthorized, http.StatusUnauthorized, "authentication failed after retry", nil)
}

func classifyTransportError(status int, respBody []byte, err error) *Error {
	msg := err.Error()

	// The agent rejects non-cluster-internal targets and reports 403.
	if status == http.StatusForbidden && strings.Contains(msg, "not cluster-internal") {
		return newError(KindUnreachable, status, "ArgoCD server address is not reachable through the agent", err)
	}
	if strings.Contains(msg, "no such host") || strings.Contains(msg, "lookup") {
		return newError(KindNotInstalled, 0, "ArgoCD server not found in the cluster", err)
	}
	if strings.Contains(msg, "connection refused") {
		return newError(KindUnreachable, 0, "ArgoCD server refused the connection", err)
	}
	if strings.Contains(msg, "context deadline exceeded") || strings.Contains(msg, "timeout") {
		return newError(KindUnreachable, 0, "ArgoCD server did not respond in time", err)
	}
	if strings.Contains(msg, "agent not found") {
		return newError(KindUnreachable, 0, "cluster agent is not connected", err)
	}
	return newError(KindUpstream, status, msg, err)
}

func classifyHTTPError(status int, respBody []byte) *Error {
	message := extractGRPCMessage(respBody)

	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return newError(KindUnauthorized, status, orDefault(message, "not authorised to call the ArgoCD API"), nil)
	case http.StatusNotFound:
		// ArgoCD returns 404 both for a missing app and for an endpoint the
		// deployed version does not implement.
		if strings.Contains(strings.ToLower(message), "not implemented") {
			return newError(KindUnsupported, status, message, nil)
		}
		return newError(KindNotFound, status, orDefault(message, "not found"), nil)
	case http.StatusNotImplemented:
		return newError(KindUnsupported, status, orDefault(message, "not supported by this ArgoCD version"), nil)
	default:
		return newError(KindUpstream, status, orDefault(message, fmt.Sprintf("ArgoCD returned %d", status)), nil)
	}
}

func orDefault(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

// extractGRPCMessage pulls the message out of a grpc-gateway error body, which
// looks like {"error":"...","code":7,"message":"..."}.
func extractGRPCMessage(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var parsed struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil {
		if parsed.Message != "" {
			return parsed.Message
		}
		if parsed.Error != "" {
			return parsed.Error
		}
	}
	return strings.TrimSpace(string(body))
}

// ensureToken returns a valid bearer token, logging in if necessary.
func (c *Client) ensureToken(ctx context.Context) (string, error) {
	c.tokenMu.RLock()
	token := c.token
	exp := c.tokenExp
	c.tokenMu.RUnlock()

	// Refresh slightly early so a long request cannot straddle expiry.
	if token != "" && (exp.IsZero() || time.Until(exp) > 5*time.Minute) {
		return token, nil
	}

	if c.credentials == nil {
		return "", newError(KindUnauthorized, 0, "no ArgoCD credentials configured", nil)
	}

	creds, err := c.credentials.Resolve(ctx)
	if err != nil {
		return "", AsError(err)
	}

	// A pre-issued token needs no login exchange.
	if creds.Token != "" {
		c.SetToken(creds.Token, tokenExpiry(creds.Token))
		return creds.Token, nil
	}

	if creds.Username == "" || creds.Password == "" {
		return "", newError(KindUnauthorized, 0,
			"no ArgoCD credentials available: set ARGOCD_AUTH_TOKEN or ARGOCD_USERNAME/ARGOCD_PASSWORD, "+
				"or ensure argocd-initial-admin-secret exists", nil)
	}

	newToken, err := c.login(ctx, creds.Username, creds.Password)
	if err != nil {
		return "", err
	}
	c.SetToken(newToken, tokenExpiry(newToken))
	return newToken, nil
}

// login exchanges username/password for a session token. It bypasses do() to
// avoid recursing through ensureToken.
func (c *Client) login(ctx context.Context, username, password string) (string, error) {
	body, err := json.Marshal(SessionRequest{Username: username, Password: password})
	if err != nil {
		return "", newError(KindUpstream, 0, "failed to encode session request", err)
	}

	status, respBody, err := c.transport.Do(ctx, http.MethodPost, c.baseURL+"/api/v1/session", nil, body,
		map[string]string{"Content-Type": "application/json", "Accept": "application/json"})
	if err != nil {
		return "", classifyTransportError(status, respBody, err)
	}
	if status >= 400 {
		e := classifyHTTPError(status, respBody)
		if status == http.StatusUnauthorized {
			e.Message = "ArgoCD rejected the configured credentials"
		}
		return "", e
	}

	// An empty token from a 200 means the request body never arrived, which is
	// the signature of an agent too old to forward bodies.
	var session SessionResponse
	if err := json.Unmarshal(respBody, &session); err != nil {
		return "", newError(KindUpstream, status, "failed to decode session response", err)
	}
	if session.Token == "" {
		return "", newError(KindAgentTooOld, status,
			"ArgoCD returned an empty session token, which usually means the cluster agent "+
				"is too old to forward request bodies; redeploy the agent", nil)
	}
	return session.Token, nil
}

// tokenExpiry reads `exp` from the JWT without verifying it. We only need the
// hint for cache management; ArgoCD verifies the signature on every call.
func tokenExpiry(token string) time.Time {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return time.Now().Add(12 * time.Hour)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Now().Add(12 * time.Hour)
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp == 0 {
		return time.Now().Add(12 * time.Hour)
	}
	return time.Unix(claims.Exp, 0)
}

// ── Reads ────────────────────────────────────────────────────────────────────

func (c *Client) Version(ctx context.Context) (*VersionInfo, error) {
	var out VersionInfo
	// Note the path: version is served at /api/version, not /api/v1/version like
	// every other endpoint.
	if err := c.do(ctx, http.MethodGet, "/api/version", nil, nil, &out); err != nil {
		return nil, err
	}
	c.versionOnce.Do(func() { c.version = &out })
	return &out, nil
}

type ListOptions struct {
	Project      string
	AppNamespace string
	Selector     string
}

func (o ListOptions) query() url.Values {
	q := url.Values{}
	if o.Project != "" {
		q.Set("projects", o.Project)
	}
	if o.AppNamespace != "" {
		q.Set("appNamespace", o.AppNamespace)
	}
	if o.Selector != "" {
		q.Set("selector", o.Selector)
	}
	return q
}

func (c *Client) ListApplications(ctx context.Context, opts ListOptions) (*ApplicationList, error) {
	var out ApplicationList
	if err := c.do(ctx, http.MethodGet, "/api/v1/applications", opts.query(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// appQuery builds the query string for app-scoped calls. appNamespace is ignored
// by ArgoCD < 2.5 rather than erroring, so no version gate is needed.
func appQuery(appNamespace string) url.Values {
	q := url.Values{}
	if appNamespace != "" {
		q.Set("appNamespace", appNamespace)
	}
	return q
}

func (c *Client) GetApplication(ctx context.Context, name, appNamespace string) (*Application, error) {
	var out Application
	path := fmt.Sprintf("/api/v1/applications/%s", url.PathEscape(name))
	if err := c.do(ctx, http.MethodGet, path, appQuery(appNamespace), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetResourceTree(ctx context.Context, name, appNamespace string) (*ResourceTree, error) {
	var out ResourceTree
	path := fmt.Sprintf("/api/v1/applications/%s/resource-tree", url.PathEscape(name))
	if err := c.do(ctx, http.MethodGet, path, appQuery(appNamespace), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetManagedResources(ctx context.Context, name, appNamespace string) (*ManagedResourceList, error) {
	var out ManagedResourceList
	path := fmt.Sprintf("/api/v1/applications/%s/managed-resources", url.PathEscape(name))
	if err := c.do(ctx, http.MethodGet, path, appQuery(appNamespace), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetManifests(ctx context.Context, name, appNamespace, revision string) (*ManifestResponse, error) {
	q := appQuery(appNamespace)
	if revision != "" {
		q.Set("revision", revision)
	}
	var out ManifestResponse
	path := fmt.Sprintf("/api/v1/applications/%s/manifests", url.PathEscape(name))
	if err := c.do(ctx, http.MethodGet, path, q, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetRevisionMetadata(ctx context.Context, name, appNamespace, revision string) (*RevisionMetadata, error) {
	var out RevisionMetadata
	path := fmt.Sprintf("/api/v1/applications/%s/revisions/%s/metadata",
		url.PathEscape(name), url.PathEscape(revision))
	if err := c.do(ctx, http.MethodGet, path, appQuery(appNamespace), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetEvents(ctx context.Context, name, appNamespace string) (map[string]interface{}, error) {
	var out map[string]interface{}
	path := fmt.Sprintf("/api/v1/applications/%s/events", url.PathEscape(name))
	if err := c.do(ctx, http.MethodGet, path, appQuery(appNamespace), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

type LogOptions struct {
	AppNamespace string
	Namespace    string
	PodName      string
	Container    string
	SinceSeconds int64
	TailLines    int64
	Filter       string
	Previous     bool
}

func (c *Client) GetLogs(ctx context.Context, name string, opts LogOptions) ([]byte, error) {
	q := appQuery(opts.AppNamespace)
	if opts.Namespace != "" {
		q.Set("namespace", opts.Namespace)
	}
	if opts.PodName != "" {
		q.Set("podName", opts.PodName)
	}
	if opts.Container != "" {
		q.Set("container", opts.Container)
	}
	if opts.SinceSeconds > 0 {
		q.Set("sinceSeconds", fmt.Sprint(opts.SinceSeconds))
	}
	if opts.TailLines > 0 {
		q.Set("tailLines", fmt.Sprint(opts.TailLines))
	}
	if opts.Filter != "" {
		q.Set("filter", opts.Filter)
	}
	if opts.Previous {
		q.Set("previous", "true")
	}
	// follow is deliberately never set: the tunnel buffers until END, so an
	// infinite stream would never return.
	q.Set("follow", "false")

	token, err := c.ensureToken(ctx)
	if err != nil {
		return nil, err
	}
	headers := map[string]string{"Accept": "application/json"}
	if token != "" {
		headers["X-Proxy-Authorization"] = "Bearer " + token
	}

	path := fmt.Sprintf("/api/v1/applications/%s/logs", url.PathEscape(name))
	status, body, err := c.transport.Do(ctx, http.MethodGet, c.baseURL+path, q, nil, headers)
	if err != nil {
		return nil, classifyTransportError(status, body, err)
	}
	if status >= 400 {
		return nil, classifyHTTPError(status, body)
	}
	return body, nil
}

func (c *Client) ListRepositories(ctx context.Context) (*RepositoryList, error) {
	var out RepositoryList
	if err := c.do(ctx, http.MethodGet, "/api/v1/repositories", nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListProjects(ctx context.Context) (*AppProjectList, error) {
	var out AppProjectList
	if err := c.do(ctx, http.MethodGet, "/api/v1/projects", nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListClusters(ctx context.Context) (*ClusterList, error) {
	var out ClusterList
	if err := c.do(ctx, http.MethodGet, "/api/v1/clusters", nil, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── Writes ───────────────────────────────────────────────────────────────────

// SyncApplication triggers a real sync. Unlike the CRD `.operation` patch it
// replaced, this cannot be silently ignored, supports a target revision and a
// resource subset, and returns the app with a fresh operationState so callers can
// correlate completion with *their* sync rather than a previous one.
func (c *Client) SyncApplication(ctx context.Context, name string, req *SyncRequest) (*Application, error) {
	var out Application
	path := fmt.Sprintf("/api/v1/applications/%s/sync", url.PathEscape(name))
	if err := c.do(ctx, http.MethodPost, path, nil, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Rollback(ctx context.Context, name string, req *RollbackRequest) (*Application, error) {
	var out Application
	path := fmt.Sprintf("/api/v1/applications/%s/rollback", url.PathEscape(name))
	if err := c.do(ctx, http.MethodPost, path, nil, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) TerminateOperation(ctx context.Context, name, appNamespace string) error {
	path := fmt.Sprintf("/api/v1/applications/%s/operation", url.PathEscape(name))
	return c.do(ctx, http.MethodDelete, path, appQuery(appNamespace), nil, nil)
}

// UpdateSpec replaces the application spec. This is how the UI changes a target
// revision (branch, tag or chart version).
func (c *Client) UpdateSpec(ctx context.Context, name, appNamespace string, spec *ApplicationSpec) (*ApplicationSpec, error) {
	var out ApplicationSpec
	path := fmt.Sprintf("/api/v1/applications/%s/spec", url.PathEscape(name))
	if err := c.do(ctx, http.MethodPut, path, appQuery(appNamespace), spec, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RefreshApplication forces a comparison against Git. `hard` also invalidates the
// repo-server cache.
func (c *Client) RefreshApplication(ctx context.Context, name, appNamespace string, hard bool) (*Application, error) {
	q := appQuery(appNamespace)
	if hard {
		q.Set("refresh", "hard")
	} else {
		q.Set("refresh", "normal")
	}
	var out Application
	path := fmt.Sprintf("/api/v1/applications/%s", url.PathEscape(name))
	if err := c.do(ctx, http.MethodGet, path, q, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
