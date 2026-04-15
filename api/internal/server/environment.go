package server

import (
	"context"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"

	"github.com/uc-cdis/gen3-admin/internal/k8s"
	"github.com/uc-cdis/gen3-admin/pkg/config"
)

type EnvironmentInfo struct {
	InCluster bool   `json:"inCluster"`
	Provider  string `json:"provider"`
	Version   string `json:"k8sVersion"`
	Namespace string `json:"namespace"`
	HasAgents bool   `json:"hasAgents"`
	Connected bool   `json:"connected"`
}

func GetEnvironmentHandler(c *gin.Context) {
	envInfo := &EnvironmentInfo{}

	// Check if running inside a Kubernetes cluster
	if _, err := rest.InClusterConfig(); err == nil {
		envInfo.InCluster = true
		if nsBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
			envInfo.Namespace = string(nsBytes)
		}
	} else {
		envInfo.InCluster = false
	}

	// Get K8s provider and version info (works both in-cluster and via kubeconfig)
	if info, err := k8s.GetInfo(); err != nil {
		log.Error().Err(err).Msg("Failed to get K8s info")
		envInfo.Provider = "Unknown"
		envInfo.Version = "Unknown"
	} else {
		envInfo.Provider = info.Provider
		envInfo.Version = info.Version
	}

	// Verify cluster connectivity by listing nodes
	clientset, _, err := config.K8sClient()
	if err != nil {
		envInfo.Connected = false
	} else if _, err := clientset.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{Limit: 1}); err != nil {
		log.Warn().Err(err).Msg("Cluster API not reachable")
		envInfo.Connected = false
	} else {
		envInfo.Connected = true
	}

	// Check if any agents are registered
	agentsMutex.RLock()
	envInfo.HasAgents = len(AgentConnections) > 0
	agentsMutex.RUnlock()

	c.JSON(http.StatusOK, envInfo)
}
