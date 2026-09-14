package server

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/uc-cdis/gen3-admin/internal/argocd"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// agentTunnelDoer adapts the agent gRPC tunnel to argocd.AgentDoer.
type agentTunnelDoer struct{}

func (agentTunnelDoer) DoAgentHTTP(
	ctx context.Context,
	agentName, method, rawURL string,
	body []byte,
	headers map[string]string,
) (int, []byte, error) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: &pb.ProxyRequest{
				StreamId:  uuid.New().String(),
				Method:    method,
				Path:      rawURL,
				Headers:   headers,
				Body:      body,
				ProxyType: "http",
			},
		},
	}

	result, err := collectAgentProxyResponse(agentName, msg, ctx)
	if err != nil {
		status := 0
		var respBody []byte
		if result != nil {
			status = result.StatusCode
			respBody = result.Body
		}
		return status, respBody, err
	}
	return result.StatusCode, result.Body, nil
}

// agentKubeReader reads Kubernetes resources through an agent, used for ArgoCD
// server discovery and to fetch the initial admin secret.
type agentKubeReader struct {
	agentName string
}

func (r agentKubeReader) Get(ctx context.Context, path string) ([]byte, error) {
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: &pb.ProxyRequest{
				StreamId:  uuid.New().String(),
				Method:    http.MethodGet,
				Path:      path,
				Headers:   map[string]string{"Accept": "application/json"},
				ProxyType: "k8s",
			},
		},
	}

	result, err := collectAgentProxyResponse(r.agentName, msg, ctx)
	if err != nil {
		return nil, err
	}
	if result.StatusCode >= 400 {
		return nil, fmt.Errorf("kubernetes returned %d for %s", result.StatusCode, path)
	}
	return result.Body, nil
}

var (
	argoRegistryOnce sync.Once
	argoRegistry     *argocd.Registry
)

func argoClients() *argocd.Registry {
	argoRegistryOnce.Do(func() {
		argoRegistry = argocd.NewRegistry(agentTunnelDoer{}, func(agentName string) argocd.KubeReader {
			return agentKubeReader{agentName: agentName}
		})
	})
	return argoRegistry
}

// InvalidateArgoCDClient drops the cached ArgoCD client for an agent. Called when
// an agent disconnects so a reconnect does not reuse a token minted against a
// possibly-different cluster.
func InvalidateArgoCDClient(agentName string) {
	if argoRegistry != nil {
		argoRegistry.Invalidate(agentName)
	}
}

// argoContext bounds every ArgoCD call and returns the client for this request.
func argoContext(c *gin.Context) (context.Context, context.CancelFunc, *argocd.Client, bool) {
	agentName := c.Param("agent")
	if !validAgentName.MatchString(agentName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid agent name"})
		return nil, nil, nil, false
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), argocd.DefaultRequestTimeout)

	client, err := argoClients().Get(ctx, agentName, c.Query("argocdNamespace"))
	if err != nil {
		cancel()
		respondArgoError(c, err)
		return nil, nil, nil, false
	}
	return ctx, cancel, client, true
}

// respondArgoError maps a classified ArgoCD failure onto an HTTP response. The
// `reason` field is the contract the frontend uses to decide whether to degrade
// to CRD reads, prompt an install, or surface a configuration problem.
func respondArgoError(c *gin.Context, err error) {
	e := argocd.AsError(err)
	log.Warn().
		Err(err).
		Str("reason", string(e.Kind)).
		Str("path", c.Request.URL.Path).
		Msg("argocd request failed")
	c.JSON(e.HTTPStatus(), e.Payload())
}

// appName is the application name from the path.
func appName(c *gin.Context) string {
	return c.Param("name")
}

func appNamespace(c *gin.Context) string {
	return c.Query("appNamespace")
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// HandleArgoCDStatus reports whether the ArgoCD API is usable. The frontend calls
// this once and uses the result to pick full or degraded mode.
func HandleArgoCDStatus(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	version, err := client.Version(ctx)
	if err != nil {
		e := argocd.AsError(err)
		// Not an error response: "ArgoCD is unavailable" is a normal answer to
		// "is ArgoCD available", and the UI renders it as a banner.
		c.JSON(http.StatusOK, gin.H{
			"available": false,
			"reason":    string(e.Kind),
			"message":   e.Message,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"available":   true,
		"version":     version.Version,
		"kubeVersion": version.KubeVersion,
	})
}

func HandleListApplications(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	apps, err := client.ListApplications(ctx, argocd.ListOptions{
		Project:      c.Query("project"),
		AppNamespace: appNamespace(c),
		Selector:     c.Query("selector"),
	})
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, apps)
}

func HandleGetApplication(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	app, err := client.GetApplication(ctx, appName(c), appNamespace(c))
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, app)
}

func HandleResourceTree(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	tree, err := client.GetResourceTree(ctx, appName(c), appNamespace(c))
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, tree)
}

func HandleManagedResources(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	resources, err := client.GetManagedResources(ctx, appName(c), appNamespace(c))
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, resources)
}

func HandleManifests(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	manifests, err := client.GetManifests(ctx, appName(c), appNamespace(c), c.Query("revision"))
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, manifests)
}

func HandleRevisionMetadata(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	metadata, err := client.GetRevisionMetadata(ctx, appName(c), appNamespace(c), c.Param("revision"))
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, metadata)
}

func HandleAppEvents(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	events, err := client.GetEvents(ctx, appName(c), appNamespace(c))
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, events)
}

func HandleAppLogs(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	tail, _ := strconv.ParseInt(c.DefaultQuery("tailLines", "1000"), 10, 64)
	since, _ := strconv.ParseInt(c.Query("sinceSeconds"), 10, 64)

	body, err := client.GetLogs(ctx, appName(c), argocd.LogOptions{
		AppNamespace: appNamespace(c),
		Namespace:    c.Query("namespace"),
		PodName:      c.Query("podName"),
		Container:    c.Query("container"),
		TailLines:    tail,
		SinceSeconds: since,
		Filter:       c.Query("filter"),
		Previous:     c.Query("previous") == "true",
	})
	if err != nil {
		respondArgoError(c, err)
		return
	}
	// ArgoCD streams newline-delimited JSON here; pass it through untouched.
	c.Data(http.StatusOK, "application/x-ndjson", body)
}

// HandleHistory returns deployment history enriched with commit metadata.
//
// Composite on purpose: resolving metadata per revision from the browser would be
// one tunnelled round trip each, and the tunnel hop is the expensive part. Fanned
// out with a small concurrency cap, tolerating individual failures since an old
// revision may have been garbage-collected from the repo cache.
func HandleHistory(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	name := appName(c)
	ns := appNamespace(c)

	app, err := client.GetApplication(ctx, name, ns)
	if err != nil {
		respondArgoError(c, err)
		return
	}

	history := app.Status.History
	if len(history) == 0 {
		c.JSON(http.StatusOK, gin.H{"items": []argocd.RevisionHistory{}})
		return
	}

	// Newest first: that is the order a history table wants.
	reversed := make([]argocd.RevisionHistory, 0, len(history))
	for i := len(history) - 1; i >= 0; i-- {
		reversed = append(reversed, history[i])
	}

	// Bounded fan-out: a long history should not open one tunnelled request per
	// revision all at once.
	const maxConcurrentMetadata = 5
	sem := make(chan struct{}, maxConcurrentMetadata)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i := range reversed {
		// Multi-source applications record `revisions` (one per source) and leave
		// `revision` empty, so reading only the latter skips them entirely.
		revision := reversed[i].Revision
		if revision == "" && len(reversed[i].Revisions) > 0 {
			revision = reversed[i].Revisions[0]
		}
		if revision == "" {
			continue
		}
		idx := i
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			metadata, err := client.GetRevisionMetadata(ctx, name, ns, revision)
			if err != nil {
				// Non-fatal: an old revision may have been garbage-collected from
				// the repo cache. Show the row without commit details.
				log.Debug().Err(err).Str("revision", revision).Msg("could not resolve revision metadata")
				return
			}
			mu.Lock()
			reversed[idx].Metadata = metadata
			mu.Unlock()
		}()
	}
	wg.Wait()

	c.JSON(http.StatusOK, gin.H{
		"items":                 reversed,
		"automatedSyncEnabled":  app.HasAutomatedSync(),
		"ownedByApplicationSet": app.OwnedByApplicationSet(),
	})
}

func HandleSync(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	var req argocd.SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sync request: " + err.Error()})
		return
	}
	if req.AppNamespace == "" {
		req.AppNamespace = appNamespace(c)
	}

	app, err := client.SyncApplication(ctx, appName(c), &req)
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, app)
}

func HandleRollback(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	var req argocd.RollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rollback request: " + err.Error()})
		return
	}
	if req.AppNamespace == "" {
		req.AppNamespace = appNamespace(c)
	}
	req.Name = appName(c)

	app, err := client.Rollback(ctx, appName(c), &req)
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, app)
}

func HandleTerminateOp(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	if err := client.TerminateOperation(ctx, appName(c), appNamespace(c)); err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "operation terminated"})
}

// HandleUpdateSpec replaces an application's spec. This is how the UI changes a
// target revision (branch, tag or Helm chart version).
func HandleUpdateSpec(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	var spec argocd.ApplicationSpec
	if err := c.ShouldBindJSON(&spec); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid spec: " + err.Error()})
		return
	}

	updated, err := client.UpdateSpec(ctx, appName(c), appNamespace(c), &spec)
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, updated)
}

func HandleRefreshApplication(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	app, err := client.RefreshApplication(ctx, appName(c), appNamespace(c), c.Query("hard") == "true")
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, app)
}

func HandleListArgoProjects(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	projects, err := client.ListProjects(ctx)
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, projects)
}

func HandleListArgoRepositories(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	repos, err := client.ListRepositories(ctx)
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, repos)
}

func HandleListArgoClusters(c *gin.Context) {
	ctx, cancel, client, ok := argoContext(c)
	if !ok {
		return
	}
	defer cancel()

	clusters, err := client.ListClusters(ctx)
	if err != nil {
		respondArgoError(c, err)
		return
	}
	c.JSON(http.StatusOK, clusters)
}

// RegisterArgoCDRoutes wires the ArgoCD API onto the protected router group.
//
// Every route is agent-scoped as /api/argocd/:agent/..., which the auth
// middleware recognises so <agent>-read and <agent>-write roles apply: GETs need
// read, and sync/rollback/spec-edit (POST/PUT/DELETE) need write.
func RegisterArgoCDRoutes(protected *gin.RouterGroup) {
	group := protected.Group("/api/argocd/:agent")
	{
		group.GET("/status", HandleArgoCDStatus)

		group.GET("/applications", HandleListApplications)
		group.GET("/applications/:name", HandleGetApplication)
		group.GET("/applications/:name/resource-tree", HandleResourceTree)
		group.GET("/applications/:name/managed-resources", HandleManagedResources)
		group.GET("/applications/:name/manifests", HandleManifests)
		group.GET("/applications/:name/revisions/:revision/metadata", HandleRevisionMetadata)
		group.GET("/applications/:name/events", HandleAppEvents)
		group.GET("/applications/:name/logs", HandleAppLogs)
		group.GET("/applications/:name/history", HandleHistory)

		group.POST("/applications/:name/sync", HandleSync)
		group.POST("/applications/:name/rollback", HandleRollback)
		group.POST("/applications/:name/terminate-op", HandleTerminateOp)
		group.POST("/applications/:name/refresh", HandleRefreshApplication)
		group.PUT("/applications/:name/spec", HandleUpdateSpec)

		group.GET("/projects", HandleListArgoProjects)
		group.GET("/repositories", HandleListArgoRepositories)
		group.GET("/clusters", HandleListArgoClusters)
	}
}
