package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/uc-cdis/gen3-admin/internal/helm"
	"github.com/uc-cdis/gen3-admin/pkg/config"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// setStreamIDOnMessage injects the given streamID into whichever inner request message
// is wrapped by the ServerMessage. This ensures the agent's response comes back on
// the correct channel (the agent uses the inner message's StreamId for routing).
func setStreamIDOnMessage(msg *pb.ServerMessage, streamID string) {
	switch m := msg.Message.(type) {
	case *pb.ServerMessage_Projects:
		m.Projects.StreamId = streamID
	case *pb.ServerMessage_HelmValuesRequest:
		m.HelmValuesRequest.StreamId = streamID
	case *pb.ServerMessage_HelmDeleteRequest:
		m.HelmDeleteRequest.StreamId = streamID
	case *pb.ServerMessage_HelmInstallRequest:
		m.HelmInstallRequest.StreamId = streamID
	case *pb.ServerMessage_Proxy:
		m.Proxy.StreamId = streamID
	case *pb.ServerMessage_DbuiRequest:
		m.DbuiRequest.StreamId = streamID
	}
}

// sendAgentProxyRequest sends a gRPC ProxyRequest to an agent and waits for the response.
// This DRYs up the repeated pattern used by helm, namespace status, and dbui handlers.
// It creates its own cancelable context derived from the parent.
func sendAgentProxyRequest(agentID string, msg *pb.ServerMessage, parentCtx context.Context) (*pb.ProxyResponse, error) {
	agentsMutex.RLock()
	agent, exists := AgentConnections[agentID]
	agentsMutex.RUnlock()
	if !exists {
		return nil, fmt.Errorf("agent not found: %s", agentID)
	}

	responseChan := make(chan *pb.ProxyResponse, 10000)
	streamID := uuid.New().String()
	ctx, cancel := context.WithCancel(parentCtx)

	// Inject our streamID into the inner message so the agent routes the response correctly
	setStreamIDOnMessage(msg, streamID)

	agent.mutex.Lock()
	agent.requestChannels[streamID] = responseChan
	agent.cancelFuncs[streamID] = cancel
	agent.contexts[streamID] = ctx
	agent.mutex.Unlock()

	if err := agent.stream.Send(msg); err != nil {
		cleanupAgentStream(agent, streamID)
		cancel()
		return nil, fmt.Errorf("failed to send request to agent: %w", err)
	}

	select {
	case resp := <-responseChan:
		cleanupAgentStream(agent, streamID)
		cancel()
		return resp, nil
	case <-ctx.Done():
		cleanupAgentStream(agent, streamID)
		return nil, fmt.Errorf("agent connection closed or request cancelled")
	}
}

// cleanupAgentStream removes a stream's channel, cancel func, and context from an agent connection
func cleanupAgentStream(agent *AgentConnection, streamID string) {
	agent.mutex.Lock()
	delete(agent.requestChannels, streamID)
	delete(agent.cancelFuncs, streamID)
	delete(agent.contexts, streamID)
	agent.mutex.Unlock()
}

// --- Agent-proxied Helm Handlers ---

func HandleAgentHelmList(c *gin.Context) {
	agentID := c.Param("agent")
	ctx := c.Request.Context()

	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_Projects{
			Projects: &pb.ProjectsRequest{StreamId: uuid.New().String()},
		},
	}

	resp, err := sendAgentProxyRequest(agentID, msg, ctx)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if resp.Status != pb.ProxyResponseType_DATA {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
		return
	}
	c.Data(http.StatusOK, "application/json", resp.Body)
}

func HandleAgentHelmValues(c *gin.Context) {
	agentID := c.Param("agent")
	releaseName := c.Param("releasename")
	namespace := c.Param("namespace")
	ctx := c.Request.Context()

	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HelmValuesRequest{
			HelmValuesRequest: &pb.HelmValuesRequest{
				StreamId:  uuid.New().String(),
				Release:   releaseName,
				Namespace: namespace,
			},
		},
	}

	resp, err := sendAgentProxyRequest(agentID, msg, ctx)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if resp.Status != pb.ProxyResponseType_DATA {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
		return
	}
	c.Data(http.StatusOK, "application/json", resp.Body)
}

func HandleAgentHelmDelete(c *gin.Context) {
	agentID := c.Param("agent")
	releaseName := c.Param("release")
	namespace := c.Param("namespace")
	ctx := c.Request.Context()

	log.Warn().Msgf("Helm delete request: %v", releaseName)

	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HelmDeleteRequest{
			HelmDeleteRequest: &pb.HelmDeleteRequest{
				StreamId:  uuid.New().String(),
				Release:   releaseName,
				Namespace: namespace,
			},
		},
	}

	resp, err := sendAgentProxyRequest(agentID, msg, ctx)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if resp.Status != pb.ProxyResponseType_DATA {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
		return
	}
	c.Data(http.StatusOK, "application/json", resp.Body)
}

func HandleAgentHelmInstall(c *gin.Context) {
	agentID := c.Param("agent")
	if agentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Agent name is required"})
		return
	}

	var requestData struct {
		Repo      string                 `json:"repo"`
		RepoUrl   string                 `json:"repoUrl"`
		Chart     string                 `json:"chart"`
		Version   string                 `json:"version"`
		Namespace string                 `json:"namespace"`
		Release   string                 `json:"release"`
		Values    map[string]interface{} `json:"values"`
	}
	if err := json.NewDecoder(c.Request.Body).Decode(&requestData); err != nil {
		log.Error().Err(err).Msg("Error decoding request data")
		http.Error(c.Writer, err.Error(), http.StatusBadRequest)
		return
	}

	installOpts := &helm.InstallOptions{
		ChartName:       requestData.Chart,
		RepoName:        requestData.Repo,
		RepoUrl:         requestData.RepoUrl,
		Namespace:       requestData.Namespace,
		ReleaseName:     requestData.Release,
		Version:         requestData.Version,
		Wait:            false,
		Timeout:         time.Minute * 5,
		CreateNamespace: true,
		Values:          requestData.Values,
	}

	if err := installOpts.Validate(); err != nil {
		log.Error().Err(err).Msg("Error validating install options")
		http.Error(c.Writer, fmt.Sprintf("Invalid request data: %s", err.Error()), http.StatusBadRequest)
		return
	}

	values, err := json.Marshal(requestData.Values)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling values")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error marshaling values"})
		return
	}

	ctx := c.Request.Context()
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_HelmInstallRequest{
			HelmInstallRequest: &pb.HelmInstallRequest{
				StreamId:  uuid.New().String(),
				Repo:      requestData.Repo,
				RepoUrl:   requestData.RepoUrl,
				Chart:     requestData.Chart,
				Version:   requestData.Version,
				Namespace: requestData.Namespace,
				Release:   requestData.Release,
				Values:    values,
			},
		},
	}

	resp, err := sendAgentProxyRequest(agentID, msg, ctx)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if resp.Status == pb.ProxyResponseType_ERROR {
		log.Warn().Msg(string(resp.Body))
		c.JSON(http.StatusInternalServerError, gin.H{"error": string(resp.Body)})
		return
	}

	if resp.Status != pb.ProxyResponseType_DATA {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
		return
	}
	c.Data(http.StatusOK, "application/json", resp.Body)
}

// --- Local Helm Handlers ---

func HandleLocalHelmInstall(c *gin.Context) {
	var requestData struct {
		Repo      string                 `json:"repo"`
		Chart     string                 `json:"chart"`
		Version   string                 `json:"version"`
		Namespace string                 `json:"namespace"`
		Release   string                 `json:"release"`
		Values    map[string]interface{} `json:"values"`
	}
	if err := json.NewDecoder(c.Request.Body).Decode(&requestData); err != nil {
		http.Error(c.Writer, "Invalid request data", http.StatusBadRequest)
		return
	}

	release, err := helm.InstallHelmChart(helm.InstallOptions{
		RepoName:        requestData.Repo,
		ChartName:       requestData.Chart,
		Version:         requestData.Version,
		ReleaseName:     requestData.Release,
		Namespace:       requestData.Namespace,
		Values:          requestData.Values,
		Wait:            false,
		Timeout:         time.Minute * 5,
		CreateNamespace: true,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, release)
}

// --- Secrets Handler ---

func HandleTLSSecretsList(c *gin.Context) {
	namespace := c.Query("namespace")
	if namespace == "" {
		namespace = "default"
	}

	clientset, _, err := config.K8sClient()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create k8s client: " + err.Error()})
		return
	}

	secrets, err := clientset.CoreV1().Secrets(namespace).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list secrets: " + err.Error()})
		return
	}

	var tlsSecrets []map[string]string
	for _, s := range secrets.Items {
		if s.Type == corev1.SecretTypeTLS {
			tlsSecrets = append(tlsSecrets, map[string]string{
				"name":      s.Name,
				"namespace": s.Namespace,
			})
		}
	}
	c.JSON(http.StatusOK, tlsSecrets)
}

// --- Namespace Deployment Status (for deploy wizard rollout tracking) ---

type depStatus struct {
	Name          string `json:"name"`
	Ready         bool   `json:"ready"`
	ReadyReplicas int32  `json:"readyReplicas"`
	TotalReplicas int32  `json:"totalReplicas"`
}

func HandleNamespaceDeploymentStatus(c *gin.Context) {
	agentID := c.Param("agent")
	namespace := c.Param("ns")
	if namespace == "" || agentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent and namespace are required"})
		return
	}

	body, _ := json.Marshal(map[string]string{"namespace": namespace})
	msg := &pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: &pb.ProxyRequest{
				StreamId: uuid.New().String(),
				Method:   "GET",
				Path:     fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments", namespace),
				Headers:  map[string]string{"Accept": "application/json"},
				Body:     body,
			},
		},
	}

	resp, err := sendAgentProxyRequest(agentID, msg, c.Request.Context())
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	if resp.Status != pb.ProxyResponseType_DATA {
		c.JSON(http.StatusOK, map[string]interface{}{
			"ready": false, "message": "Waiting for deployments...", "deployments": []interface{}{}, "totalReady": 0, "totalCount": 0,
		})
		return
	}

	var k8sResp struct {
		Items []struct {
			Metadata struct{ Name string } `json:"metadata"`
			Spec     struct { Replicas *int32 `json:"replicas"` } `json:"spec"`
			Status   struct {
				AvailableReplicas int32 `json:"availableReplicas"`
				Replicas           int32 `json:"replicas"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(resp.Body, &k8sResp); err != nil {
		c.Data(http.StatusOK, "application/json", resp.Body)
		return
	}

	var results []depStatus
	totalReady, totalCount := 0, 0
	allReady := true

	for _, d := range k8sResp.Items {
		tr := int32(1)
		if d.Spec.Replicas != nil && *d.Spec.Replicas > 0 {
			tr = *d.Spec.Replicas
		}
		rr := d.Status.AvailableReplicas
		ready := rr >= tr && tr > 0
		if !ready {
			allReady = false
		}
		totalReady += int(rr)
		totalCount += int(tr)
		results = append(results, depStatus{Name: d.Metadata.Name, Ready: ready, ReadyReplicas: rr, TotalReplicas: tr})
	}

	c.JSON(http.StatusOK, map[string]interface{}{
		"ready": allReady && len(k8sResp.Items) > 0, "deployments": results, "totalReady": totalReady, "totalCount": totalCount,
	})
}

// --- Local Helm Query Handlers ---

func HandleHelmShowValues(c *gin.Context) {
	releaseName := c.Param("release")
	values, err := helm.ShowHelmValues(releaseName, "default")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, values)
}

func HandleHelmReposList(c *gin.Context) {
	repos, err := helm.ListHelmRepos()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, repos)
}

func HandleHelmChartsList(c *gin.Context) {
	repo := c.Param("repo")
	charts, err := helm.ListHelmCharts(repo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, charts)
}

// RegisterHelmRoutes registers all helm-related routes on the gin engine
func RegisterHelmRoutes(r *gin.Engine) {
	// Agent-proxied helm operations
	r.GET("/api/agents/:agent/helm/list", HandleAgentHelmList)
	r.GET("/api/agent/:agent/helm/values/:releasename/:namespace", HandleAgentHelmValues)
	r.DELETE("/api/agent/:agent/helm/delete/:release/:namespace", HandleAgentHelmDelete)
	r.POST("/api/agent/:agent/helm/install", HandleAgentHelmInstall)

	// Local helm operations
	r.POST("/api/helm/install", HandleLocalHelmInstall)
	r.GET("/api/helm/values/:release", HandleHelmShowValues)
	r.GET("/api/helm/repos", HandleHelmReposList)
	r.GET("/api/helm/charts/:repo", HandleHelmChartsList)

	// Secrets
	r.GET("/api/secrets/tls", HandleTLSSecretsList)

	// Namespace deployment status (for deploy wizard)
	r.GET("/api/agent/:agent/namespace/:ns/status", HandleNamespaceDeploymentStatus)
}
