package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"

	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/uc-cdis/gen3-admin/internal/k8s"
	"github.com/uc-cdis/gen3-admin/pkg/config"
)

// InstallArgoCDHandler installs ArgoCD into the cluster via k8s SDK
func InstallArgoCDHandler(c *gin.Context) {
	log.Info().Msg("InstallArgoCDHandler - installing ArgoCD into cluster")

	clientset, _, err := config.K8sClient()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create k8s client: " + err.Error()})
		return
	}

	// 1. Ensure argocd namespace exists
	_, err = clientset.CoreV1().Namespaces().Create(
		context.TODO(),
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "argocd"}},
		metav1.CreateOptions{},
	)
	if err != nil {
		if !errors.IsAlreadyExists(err) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create argocd namespace: " + err.Error()})
			return
		}
	}
	log.Info().Msg("Ensured argocd namespace exists")

	// 2. Apply CRDs from remote URL
	crdURL := "https://raw.githubusercontent.com/argoproj/argo-cd/manifests/crds?ref=stable"
	crdOutput, crdErr := applyRemoteYAML(crdURL, "argocd")
	if crdErr != nil {
		log.Warn().Err(crdErr).Str("output", crdOutput).Msg("CRD apply had errors (some may already exist)")
	} else {
		log.Info().Str("output", crdOutput).Msg("ArgoCD CRDs applied successfully")
	}

	// 3. Apply ArgoCD install manifest
	installURL := "https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml"
	installOutput, installErr := applyRemoteYAML(installURL, "argocd")
	if installErr != nil {
		log.Warn().Err(installErr).Str("output", installOutput).Msg("ArgoCD install had some errors (resources may still be applied)")
	} else {
		log.Info().Str("output", installOutput).Msg("ArgoCD installed successfully")
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "ArgoCD installation initiated",
		"namespace": "argocd",
		"crdOutput": strings.TrimSpace(crdOutput),
		"output":    strings.TrimSpace(installOutput),
	})
}

// InstallAppsHandler creates ArgoCD Application CR(s) to deploy apps via GitOps
func InstallAppsHandler(c *gin.Context) {
	log.Info().Msg("InstallAppsHandler - deploying apps via ArgoCD")

	var req struct {
		StorageType        string `json:"storageType"` // "pvc" or "s3"
		Skip               bool   `json:"skip"`        // skip monitoring deployment entirely
		Mode               string `json:"mode"`        // "full" (lgtm-distributed) or "lightweight" (loki SingleBinary)
		S3Bucket           string `json:"s3Bucket,omitempty"`
		S3Region           string `json:"s3Region,omitempty"`
		AWSAccessKeyID     string `json:"awsAccessKeyID,omitempty"`
		AWSSecretAccessKey string `json:"awsSecretAccessKey,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	// Skip monitoring stack deployment
	if req.Skip {
		log.Info().Msg("InstallAppsHandler - monitoring stack skipped")
		c.JSON(http.StatusOK, gin.H{
			"message":         "Monitoring stack deployment skipped",
			"skipped":         true,
			"targetNamespace": "monitoring",
		})
		return
	}

	// Default mode to full if not specified
	if req.Mode == "" {
		req.Mode = "full"
	}

	if req.Mode != "full" && req.Mode != "lightweight" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be 'full' or 'lightweight'"})
		return
	}

	if req.StorageType != "pvc" && req.StorageType != "s3" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "storageType must be 'pvc' or 's3'"})
		return
	}

	// If S3, validate credentials via AWS SDK
	if req.StorageType == "s3" {
		if req.S3Bucket == "" || req.S3Region == "" || req.AWSAccessKeyID == "" || req.AWSSecretAccessKey == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "S3 requires bucket, region, accessKeyID, and secretAccessKey"})
			return
		}
		if s3Err := validateS3Bucket(req.S3Bucket, req.S3Region, req.AWSAccessKeyID, req.AWSSecretAccessKey); s3Err != nil {
			log.Warn().Err(s3Err).Msg("S3 credential validation failed")
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "S3 validation failed",
				"details": s3Err.Error(),
			})
			return
		}
		log.Info().Str("bucket", req.S3Bucket).Msg("S3 credentials validated")
	}

	// Build ArgoCD Application CR YAML based on mode
	var appCR string
	var lokiEndpoint string
	if req.Mode == "lightweight" {
		appCR = buildLightweightMonitoringAppCR(req.StorageType, req.S3Bucket, req.S3Region)
		lokiEndpoint = "http://monitoring-loki-gateway.monitoring:8080/loki/api/v1/push"
	} else {
		appCR = buildMonitoringAppCR(req.StorageType, req.S3Bucket, req.S3Region)
		lokiEndpoint = "http://monitoring-loki-distributor.monitoring:3100/loki/api/v1/push"
	}

	// Apply the Application CR into argocd namespace
	if err := k8s.ApplyYAMLToCluster(appCR, "argocd"); err != nil {
		log.Error().Err(err).Msg("Failed to apply ArgoCD Application CR")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create ArgoCD application: " + err.Error()})
		return
	}

	log.Info().Str("mode", req.Mode).Msg("ArgoCD Application 'monitoring' created successfully")
	c.JSON(http.StatusOK, gin.H{
		"message":         "Monitoring stack deployment initiated",
		"appName":         "monitoring",
		"mode":            req.Mode,
		"storageType":     req.StorageType,
		"targetNamespace": "monitoring",
		"lokiEndpoint":    lokiEndpoint,
	})
}

// buildMonitoringAppCR constructs an ArgoCD Application CR YAML for lgtm-distributed
func buildMonitoringAppCR(storageType, s3Bucket, s3Region string) string {
	helmValues := ""
	if storageType == "s3" && s3Bucket != "" {
		helmValues = fmt.Sprintf(`
    helm:
      values: |
        loki:
          objectStorage:
            type: s3
            s3:
              bucketName: %s
              region: %s
              insecure: true`, s3Bucket, s3Region)
	}

	return fmt.Sprintf(`---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: monitoring
  namespace: argocd
spec:
  project: default
  destination:
    namespace: monitoring
    server: https://kubernetes.default.svc
  source:
    chart: lgtm-distributed
    repoURL: https://grafana.github.io/helm-charts
    targetRevision: "*"
%s  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
`, helmValues)
}

// buildLightweightMonitoringAppCR constructs an ArgoCD Application CR YAML for
// the standalone loki chart in SingleBinary mode + Grafana (~4-5 pods total).
// This is ideal for workshops, Minikube, and low-resource clusters.
func buildLightweightMonitoringAppCR(storageType, s3Bucket, s3Region string) string {
	storageValues := ""
	if storageType == "s3" && s3Bucket != "" {
		storageValues = fmt.Sprintf(`
        loki:
          storage:
            type: s3
            s3:
              bucketName: %s
              endpoint: s3.%%s.amazonaws.com
              region: %%s
              insecure: true
            bucketNames:
              chunks: %%s-chunks
              ruler: %%s-ruler
              admin: %%s-admin
        minio:
          enabled: true`, s3Bucket, s3Region, s3Region, s3Bucket, s3Bucket, s3Bucket)
	} else {
		storageValues = `
        loki:
          storage:
            type: filesystem
          schemaConfig:
            configs:
              - from: "2024-04-01"
                store: tsdb
                object_store: filesystem
                schema: v13
                index:
                  prefix: loki_index_
                  period: 24h`
	}

	return fmt.Sprintf(`---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: monitoring
  namespace: argocd
spec:
  project: default
  destination:
    namespace: monitoring
    server: https://kubernetes.default.svc
  source:
    chart: loki
    repoURL: https://grafana.github.io/helm-charts
    targetRevision: "*"
    helm:
      values: |
        deploymentMode: SingleBinary

        singleBinary:
          replicas: 1

        # Zero out all non-SingleBinary deployment mode targets
        backend:
          replicas: 0
        read:
          replicas: 0
        write:
          replicas: 0
        ingester:
          replicas: 0
        querier:
          replicas: 0
        queryFrontend:
          replicas: 0
        queryScheduler:
          replicas: 0
        distributor:
          replicas: 0
        compactor:
          replicas: 0
        indexGateway:
          replicas: 0
        bloomCompactor:
          replicas: 0
        bloomGateway:
          replicas: 0

        # Disable heavy caches for lightweight mode
        chunksCache:
          enabled: false
        resultsCache:
          enabled: false

        loki:
          commonConfig:
            replication_factor: 1
          ingester:
            chunk_encoding: snappy%s

        gateway:
          enabled: true
          replicas: 1

        grafana:
          enabled: true
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
`, storageValues)
}

// BootstrapStatusHandler returns health status of all bootstrapped components
func BootstrapStatusHandler(c *gin.Context) {
	status := map[string]interface{}{
		"agent":  checkAgentStatus(),
		"argocd": checkArgoCDStatus(),
		"apps":   checkAppsStatus(),
		"alloy":  checkAlloyStatus(),
	}

	c.JSON(http.StatusOK, status)
}

func checkAgentStatus() map[string]interface{} {
	agentsMutex.RLock()
	defer agentsMutex.RUnlock()

	for name, conn := range AgentConnections {
		if conn.agent.Connected {
			return map[string]interface{}{"ready": true, "name": name}
		}
	}
	return map[string]interface{}{"ready": false, "message": "No connected agents"}
}

func checkArgoCDStatus() map[string]interface{} {
	kubeConfig, err := k8s.GetConfig()
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot connect to cluster"}
	}
	dynamicClient, err := dynamic.NewForConfig(kubeConfig)
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot create dynamic client"}
	}

	gvr := schema.GroupVersionResource{
		Group:    "apps",
		Version:  "v1",
		Resource: "deployments",
	}
	resource := dynamicClient.Resource(gvr).Namespace("argocd")
	deploys, err := resource.List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot list deployments in argocd namespace"}
	}

	if len(deploys.Items) == 0 {
		return map[string]interface{}{"ready": false, "message": "No deployments found (not installed yet)"}
	}

	// Check that ArgoCD CRDs are installed (required for ArgoCD to function)
	apiExtClient, err := apiextensionsclientset.NewForConfig(kubeConfig)
	if err != nil {
		log.Warn().Err(err).Msg("Could not create apiextensions client for CRD check")
	}
	crdNames := []string{
		"applications.argoproj.io",
		"applicationsets.argoproj.io",
		"appprojects.argoproj.io",
	}
	crdsReady := true
	var missingCRDs []string
	if apiExtClient != nil {
		for _, crdName := range crdNames {
			parts := strings.SplitN(crdName, ".", 2)
			if len(parts) != 2 {
				continue
			}
			_, err := apiExtClient.ApiextensionsV1().CustomResourceDefinitions().Get(context.TODO(), crdName, metav1.GetOptions{})
			if err != nil {
				missingCRDs = append(missingCRDs, crdName)
				crdsReady = false
			}
		}
	}

	// Check each core ArgoCD component by deployment name
	coreComponents := []string{
		"argocd-server",
		"argocd-repo-server",
		"argocd-applicationset-controller",
		"argocd-dex-server",
		"argocd-redis",
		"argocd-notifications-controller",
	}
	componentStatus := make(map[string]interface{})
	allReady := true
	totalReady := 0
	totalCount := 0

	for _, name := range coreComponents {
		var found *unstructured.Unstructured
		for i := range deploys.Items {
			if deploys.Items[i].GetName() == name {
				found = &deploys.Items[i]
				break
			}
		}
		if found == nil {
			componentStatus[name] = map[string]interface{}{"ready": false, "message": "Not found yet"}
			allReady = false
			continue
		}

		readyReplicas := int64(0)
		totalReplicas := int64(1)
		if spec, ok := found.Object["spec"].(map[string]interface{}); ok {
			if r, ok := spec["replicas"].(int64); ok {
				totalReplicas = r
			}
		}
		if st, ok := found.Object["status"].(map[string]interface{}); ok {
			if available, ok := st["availableReplicas"].(int64); ok {
				readyReplicas = available
			}
		}

		isReady := readyReplicas >= totalReplicas && totalReplicas > 0
		if !isReady {
			allReady = false
		}
		totalReady += int(readyReplicas)
		totalCount += int(totalReplicas)

		componentStatus[name] = map[string]interface{}{
			"ready":         isReady,
			"readyReplicas": readyReplicas,
			"totalReplicas": totalReplicas,
		}
	}

	if !crdsReady {
		allReady = false
		componentStatus["crds"] = map[string]interface{}{
			"ready":   false,
			"message": fmt.Sprintf("Missing CRDs: %v", missingCRDs),
		}
	} else {
		componentStatus["crds"] = map[string]interface{}{
			"ready":   true,
			"message": "All CRDs installed",
		}
	}

	return map[string]interface{}{
		"ready":      allReady && crdsReady,
		"totalReady": totalReady,
		"totalCount": totalCount,
		"message":    fmt.Sprintf("%d/%d components ready, CRDs: %s", totalReady, totalCount, map[bool]string{true: "installed", false: fmt.Sprintf("missing (%v)", missingCRDs)}[crdsReady]),
		"components": componentStatus,
	}
}

func checkAppsStatus() map[string]interface{} {
	kubeConfig, err := k8s.GetConfig()
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot connect to cluster"}
	}
	dynamicClient, err := dynamic.NewForConfig(kubeConfig)
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot create dynamic client"}
	}

	// Check ArgoCD Application CR status
	appGVR := schema.GroupVersionResource{
		Group:    "argoproj.io",
		Version:  "v1alpha1",
		Resource: "applications",
	}
	appResource := dynamicClient.Resource(appGVR).Namespace("argocd")

	app, err := appResource.Get(context.TODO(), "monitoring", metav1.GetOptions{})
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "No apps deployed yet"}
	}

	var healthStatus, syncStatus, syncDetails, healthMessage string
	if status, ok := app.Object["status"].(map[string]interface{}); ok {
		if health, ok := status["health"].(map[string]interface{}); ok {
			healthStatus, _ = health["status"].(string)
			healthMessage, _ = health["message"].(string)
		}
		if sync, ok := status["sync"].(map[string]interface{}); ok {
			syncStatus, _ = sync["status"].(string)
			syncDetails, _ = sync["message"].(string)
		}
	}

	// Check deployments in monitoring namespace for detailed component status
	depGVR := schema.GroupVersionResource{
		Group:    "apps",
		Version:  "v1",
		Resource: "deployments",
	}
	depResource := dynamicClient.Resource(depGVR).Namespace("monitoring")
	deploys, err := depResource.List(context.TODO(), metav1.ListOptions{})

	componentStatus := make(map[string]interface{})
	allPodsReady := true
	totalReady := 0
	totalCount := 0

	if err == nil && len(deploys.Items) > 0 {
		for _, dep := range deploys.Items {
			name := dep.GetName()
			readyReplicas := int64(0)
			totalReplicas := int64(1)
			if spec, ok := dep.Object["spec"].(map[string]interface{}); ok {
				if r, ok := spec["replicas"].(int64); ok {
					totalReplicas = r
				}
			}
			if st, ok := dep.Object["status"].(map[string]interface{}); ok {
				if available, ok := st["availableReplicas"].(int64); ok {
					readyReplicas = available
				}
			}

			isDepReady := readyReplicas >= totalReplicas && totalReplicas > 0
			if !isDepReady {
				allPodsReady = false
			}
			totalReady += int(readyReplicas)
			totalCount += int(totalReplicas)

			componentStatus[name] = map[string]interface{}{
				"ready":         isDepReady,
				"readyReplicas": readyReplicas,
				"totalReplicas": totalReplicas,
			}
		}
	} else {
		allPodsReady = false
	}

	// Consider ready when all pods are up. ArgoCD may report "Progressing" even when
	// everything is healthy (e.g. final reconciliation bookkeeping). Don't block the user.
	syncOk := syncStatus == "Synced" || syncStatus == "" || syncStatus == "Progressing"
	appIsHealthy := healthStatus == "Healthy" || healthStatus == ""
	isReady := (appIsHealthy || syncOk) && allPodsReady && totalCount > 0

	return map[string]interface{}{
		"ready":         isReady,
		"health":        healthStatus,
		"syncStatus":    syncStatus,
		"totalReady":    totalReady,
		"totalCount":    totalCount,
		"message":       fmt.Sprintf("Health: %s | Sync: %s | Pods: %d/%d", healthStatus, syncStatus, totalReady, totalCount),
		"healthMessage": healthMessage,
		"syncDetails":   syncDetails,
		"components":    componentStatus,
	}
}

// ConfigMapHandler handles GET (read) and POST (update) for ConfigMap keys
func ConfigMapHandler(c *gin.Context) {
	name := c.Query("name")
	namespace := c.Query("namespace")
	key := c.Query("key")

	if name == "" || namespace == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name and namespace query params required"})
		return
	}

	clientset, _, err := config.K8sClient()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot create k8s client: " + err.Error()})
		return
	}

	if c.Request.Method == "GET" {
		cm, err := clientset.CoreV1().ConfigMaps(namespace).Get(context.TODO(), name, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "configmap not found: " + err.Error()})
			return
		}
		if key != "" {
			if val, ok := cm.Data[key]; ok {
				c.JSON(http.StatusOK, gin.H{"data": map[string]string{key: val}})
			} else {
				c.JSON(http.StatusNotFound, gin.H{"error": "key '" + key + "' not found in configmap"})
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": cm.Data, "metadata": map[string]string{
			"name":      cm.Name,
			"namespace": cm.Namespace,
		}})
		return
	}

	// POST — update a specific key
	var req struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
		Key       string `json:"key"`
		Data      string `json:"data"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}
	if req.Key == "" || req.Data == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key and data are required"})
		return
	}

	cm, err := clientset.CoreV1().ConfigMaps(req.Namespace).Get(context.TODO(), req.Name, metav1.GetOptions{})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "configmap not found: " + err.Error()})
		return
	}
	if cm.Data == nil {
		cm.Data = make(map[string]string)
	}
	cm.Data[req.Key] = req.Data

	_, err = clientset.CoreV1().ConfigMaps(req.Namespace).Update(context.TODO(), cm, metav1.UpdateOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update configmap: " + err.Error()})
		return
	}
	log.Info().Str("name", req.Name).Str("namespace", req.Namespace).Str("key", req.Key).Msg("ConfigMap updated")

	// Extract and return the Loki URL for convenience
	lokiURL := extractLokiURL(req.Data)
	c.JSON(http.StatusOK, gin.H{
		"message": "configmap updated",
		"lokiURL": lokiURL,
	})
}

// extractLokiURL attempts to find the Loki push URL in an Alloy config string
func extractLokiURL(config string) string {
	// Match url = "..." inside loki.write block
	re := regexp.MustCompile(`(?s)loki\.write\s+["\w]+.*?url\s*=\s*"([^"]+)"`)
	matches := re.FindStringSubmatch(config)
	if len(matches) >= 2 {
		return matches[1]
	}
	return ""
}

// InstallAlloyHandler deploys Grafana Alloy via ArgoCD Application CR + ConfigMap
func InstallAlloyHandler(c *gin.Context) {
	log.Info().Msg("InstallAlloyHandler - deploying Grafana Alloy")

	var req struct {
		LokiAddress string `json:"lokiAddress"` // Loki push URL for alloy config
		Cluster     string `json:"cluster"`     // external cluster label
		Project     string `json:"project"`     // external project label
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
		return
	}

	if req.LokiAddress == "" {
		req.LokiAddress = "http://monitoring-loki-distributor.monitoring:3100/loki/api/v1/push"
	}
	if req.Cluster == "" {
		req.Cluster = "csoc"
	}
	if req.Project == "" {
		req.Project = "csoc"
	}

	// Build the YAML documents: AppCR + ConfigMap
	yamlDocs := buildAlloyResources(req.LokiAddress, req.Cluster, req.Project)

	if err := k8s.ApplyYAMLToCluster(yamlDocs, "argocd"); err != nil {
		log.Error().Err(err).Msg("Failed to apply Alloy resources")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to deploy Alloy: " + err.Error()})
		return
	}

	log.Info().Str("loki", req.LokiAddress).Msg("Grafana Alloy deployment initiated")
	c.JSON(http.StatusOK, gin.H{
		"message":         "Alloy deployment initiated via ArgoCD",
		"appName":         "grafana-alloy",
		"configMap":       "alloy-gen3",
		"targetNamespace": "monitoring",
		"lokiAddress":     req.LokiAddress,
	})
}

// buildAlloyResources constructs the YAML for ArgoCD Application CR + ConfigMap
func buildAlloyResources(lokiAddress string, cluster string, project string) string {
	alloyConfig := buildAlloyConfigMapData(lokiAddress, cluster, project)

	appCR := fmt.Sprintf(`---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: grafana-alloy
  namespace: argocd
spec:
  project: default
  source:
    chart: alloy
    repoURL: https://grafana.github.io/helm-charts
    targetRevision: 0.4.0
    helm:
      releaseName: alloy
      values: |
        controller:
          type: "deployment"
        alloy:
          stabilityLevel: "public-preview"
          uiPathPrefix: /alloy
          extraPorts:
            - name: "otel-grpc"
              port: 4317
              targetPort: 4317
              protocol: "TCP"
            - name: "otel-http"
              port: 4318
              targetPort: 4318
              protocol: "TCP"
          clustering:
            enabled: true
          configMap:
            name: alloy-gen3
            key: config
          resources:
            requests:
              cpu: 1000m
              memory: 1Gi
  syncPolicy:
    syncOptions:
    - CreateNamespace=true
    automated:
      selfHeal: true
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: alloy-gen3
  namespace: monitoring
data:
  config: |
%s`, indentConfig(alloyConfig))

	return appCR
}

// buildAlloyConfigMapData builds the Grafana Alloy HCL configuration with injected Loki address
func buildAlloyConfigMapData(lokiAddress string, cluster string, project string) string {
	return fmt.Sprintf(`logging {
  level    = "info"
  format   = "json"
  write_to = [loki.write.endpoint.receiver]
}

/////////////////////// OTLP START ///////////////////////

otelcol.receiver.otlp "default" {
  grpc {}
  http {}

  output {
    metrics = [otelcol.processor.batch.default.input]
    traces = [otelcol.processor.batch.default.input]
  }
}

otelcol.processor.batch "default" {
  output {
    metrics = [otelcol.exporter.prometheus.default.input]
    traces  = [otelcol.exporter.otlphttp.tempo.input]
  }
}

otelcol.exporter.prometheus "default" {
  forward_to = [prometheus.remote_write.default.receiver]
}

otelcol.exporter.otlphttp "tempo" {
  client {
    endpoint = "http://monitoring-tempo-distributor.monitoring:4317"
    tls {
      insecure = true
      insecure_skip_verify = true
    }
  }
}


/////////////////////// OTLP END ///////////////////////

discovery.kubernetes "pods" {
  role = "pod"
}

discovery.kubernetes "services" {
  role = "service"
}

discovery.kubernetes "nodes" {
  role = "node"
}

discovery.relabel "annotation_autodiscovery_pods" {
  targets = discovery.kubernetes.pods.targets
  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_scrape"]
    regex = "true"
    action = "keep"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_job"]
    action = "replace"
    target_label = "job"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_instance"]
    action = "replace"
    target_label = "instance"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_path"]
    action = "replace"
    target_label = "__metrics_path__"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_container_port_name"]
    target_label = "__tmp_port"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_portName"]
    regex = "(.+)"
    target_label = "__tmp_port"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_port_name"]
    action = "keepequal"
    target_label = "__tmp_port"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_port", "__meta_kubernetes_pod_ip"]
    regex = "(\\d+);(([A-Fa-f0-9]{1,4}:?){1,7}[A-Fa-f0-9]{1,4})"
    replacement = "[$2]:$1"
    target_label = "__address__"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_port", "__meta_kubernetes_pod_ip"]
    regex = "(\\d+);((([0-9]+?)(\\.|$)){4})"
    replacement = "$2:$1"
    target_label = "__address__"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_scheme"]
    action = "replace"
    target_label = "__scheme__"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label = "container"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_controller_name"]
    target_label = "controller"
  }

  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label = "namespace"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_label_app"]
    target_label = "app"
  }

  rule {
    action = "labelmap"
    regex  = "__meta_kubernetes_pod_label_(.+)"
  }
}

discovery.relabel "annotation_autodiscovery_services" {
  targets = discovery.kubernetes.services.targets
  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_scrape"]
    regex = "true"
    action = "keep"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_job"]
    action = "replace"
    target_label = "job"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_instance"]
    action = "replace"
    target_label = "instance"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_path"]
    action = "replace"
    target_label = "__metrics_path__"
  }

  rule {
    source_labels = ["__meta_kubernetes_service_port_name"]
    target_label = "__tmp_port"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_portName"]
    regex = "(.+)"
    target_label = "__tmp_port"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_port_name"]
    action = "keepequal"
    target_label = "__tmp_port"
  }

  rule {
    source_labels = ["__meta_kubernetes_service_port_number"]
    target_label = "__tmp_port"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_port"]
    regex = "(.+)"
    target_label = "__tmp_port"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_port_name"]
    action = "keepequal"
    target_label = "__tmp_port"
  }

  rule {
    source_labels = ["__meta_kubernetes_service_annotation_prometheus_io_scheme"]
    action = "replace"
    target_label = "__scheme__"
  }
}

prometheus.scrape "metrics" {
  job_name   = "integrations/autodiscovery_metrics"
  targets  = concat(discovery.relabel.annotation_autodiscovery_pods.output, discovery.relabel.annotation_autodiscovery_services.output)
  honor_labels = true
  clustering {
    enabled = true
  }
  forward_to = [prometheus.relabel.metrics_service.receiver]
}

discovery.relabel "node_exporter" {
  targets = discovery.kubernetes.pods.targets
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_instance"]
    regex = "monitoring-extras"
    action = "keep"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
    regex = "node-exporter"
    action = "keep"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_node_name"]
    action = "replace"
    target_label = "instance"
  }
}

prometheus.scrape "node_exporter" {
  job_name   = "integrations/node_exporter"
  targets  = discovery.relabel.node_exporter.output
  scrape_interval = "60s"
  clustering {
    enabled = true
  }
  forward_to = [prometheus.relabel.node_exporter.receiver]
}

prometheus.relabel "node_exporter" {
  rule {
    source_labels = ["__name__"]
    regex = "up|node_cpu.*|node_network.*|node_exporter_build_info|node_filesystem.*|node_memory.*|process_cpu_seconds_total|process_resident_memory_bytes"
    action = "keep"
  }
  forward_to = [prometheus.relabel.metrics_service.receiver]
}

discovery.relabel "all_pods" {
  targets = discovery.kubernetes.pods.targets
  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label = "container"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_controller_name"]
    target_label = "controller"
  }

  rule {
    source_labels = ["__meta_kubernetes_pod_label_app"]
    target_label = "app"
  }

  rule {
    action = "labelmap"
    regex  = "__meta_kubernetes_pod_label_(.+)"
  }
}

loki.source.kubernetes "pods" {
  targets = discovery.relabel.all_pods.output
  forward_to = [loki.write.endpoint.receiver]
}

discovery.relabel "relabel_kube_state_metrics" {
  targets = discovery.kubernetes.services.targets
  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    regex = "monitoring"
    action = "keep"
  }
  rule {
    source_labels = ["__meta_kubernetes_service_name"]
    regex = "monitoring-extras-kube-state-metrics"
    action = "keep"
  }
}

prometheus.scrape "kube_state_metrics" {
  targets = discovery.relabel.relabel_kube_state_metrics.output
  job_name = "kube-state-metrics"
  metrics_path = "/metrics"
  forward_to = [prometheus.remote_write.default.receiver]
}

discovery.relabel "kubelet" {
  targets = discovery.kubernetes.nodes.targets
  rule {
    target_label = "__address__"
    replacement  = "kubernetes.default.svc.cluster.local:443"
  }
  rule {
    source_labels = ["__meta_kubernetes_node_name"]
    regex         = "(.+)"
    replacement   = "/api/v1/nodes/${1}/proxy/metrics"
    target_label  = "__metrics_path__"
  }
}

prometheus.scrape "kubelet" {
  job_name   = "integrations/kubernetes/kubelet"
  targets  = discovery.relabel.kubelet.output
  scheme   = "https"
  scrape_interval = "60s"
  bearer_token_file = "/var/run/secrets/kubernetes.io/serviceaccount/token"
  tls_config {
    insecure_skip_verify = true
  }
  clustering {
    enabled = true
  }
  forward_to = [prometheus.relabel.kubelet.receiver]
}

prometheus.relabel "kubelet" {
  rule {
    source_labels = ["__name__"]
    regex = "up|container_cpu_usage_seconds_total|kubelet_certificate_manager_client_expiration_renew_errors|kubelet_certificate_manager_client_ttl_seconds|kubelet_certificate_manager_server_ttl_seconds|kubelet_cgroup_manager_duration_seconds_bucket|kubelet_cgroup_manager_duration_seconds_count|kubelet_node_config_error|kubelet_node_name|kubelet_pleg_relist_duration_seconds_bucket|kubelet_pleg_relist_duration_seconds_count|kubelet_pleg_relist_interval_seconds_bucket|kubelet_pod_start_duration_seconds_bucket|kubelet_pod_start_duration_seconds_count|kubelet_pod_worker_duration_seconds_bucket|kubelet_pod_worker_duration_seconds_count|kubelet_running_container_count|kubelet_running_containers|kubelet_running_pod_count|kubelet_running_pods|kubelet_runtime_operations_errors_total|kubelet_runtime_operations_total|kubelet_server_expiration_renew_errors|kubelet_volume_stats_available_bytes|kubelet_volume_stats_capacity_bytes|kubelet_volume_stats_inodes|kubelet_volume_stats_inodes_used|kubernetes_build_info|namespace_workload_pod|rest_client_requests_total|storage_operation_duration_seconds_count|storage_operation_errors_total|volume_manager_total_volumes"
    action = "keep"
  }
  forward_to = [prometheus.relabel.metrics_service.receiver]
}

loki.source.kubernetes_events "cluster_events" {
  job_name   = "integrations/kubernetes/eventhandler"
  log_format = "logfmt"
  forward_to = [loki.write.endpoint.receiver]
}

prometheus.relabel "metrics_service" {
  forward_to = [prometheus.remote_write.default.receiver]
}

prometheus.remote_write "default" {
  external_labels = {
    cluster = "%s",
    project = "%s",
  }
  endpoint {
    url = "https://mimir.planx-pla.net/api/v1/push"

    headers = {
      "X-Scope-OrgID" = "anonymous",
    }

  }
}

loki.write "endpoint" {
  external_labels =  {
    cluster = "%s",
    project = "%s",
  }
  endpoint {
    url = "%s"
  }
}`, cluster, project, cluster, project, lokiAddress)
}

// indents each line of config for embedding inside the YAML ConfigMap data field
func indentConfig(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if line != "" {
			lines[i] = "    " + line
		}
	}
	return strings.Join(lines, "\n")
}

func checkAlloyStatus() map[string]interface{} {
	kubeConfig, err := k8s.GetConfig()
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot connect to cluster"}
	}
	dynamicClient, err := dynamic.NewForConfig(kubeConfig)
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot create dynamic client"}
	}

	// Check if alloy-gen3 ConfigMap exists (proves alloy was configured)
	clientset, _, err := config.K8sClient()
	if err != nil {
		return map[string]interface{}{"ready": false, "message": "Cannot create k8s client"}
	}
	_, cmErr := clientset.CoreV1().ConfigMaps("monitoring").Get(context.TODO(), "alloy-gen3", metav1.GetOptions{})
	configMapExists := cmErr == nil

	// Extract Loki URL from configmap if it exists
	var lokiURL string
	if configMapExists {
		cm, _ := clientset.CoreV1().ConfigMaps("monitoring").Get(context.TODO(), "alloy-gen3", metav1.GetOptions{})
		if cm != nil && cm.Data != nil {
			lokiURL = extractLokiURL(cm.Data["config"])
		}
	}

	// Check ArgoCD Application CR for grafana-alloy
	appGVR := schema.GroupVersionResource{
		Group:    "argoproj.io",
		Version:  "v1alpha1",
		Resource: "applications",
	}
	appResource := dynamicClient.Resource(appGVR).Namespace("argocd")

	app, appErr := appResource.Get(context.TODO(), "grafana-alloy", metav1.GetOptions{})
	appExists := appErr == nil

	var healthStatus, syncStatus string
	if appExists {
		if status, ok := app.Object["status"].(map[string]interface{}); ok {
			if health, ok := status["health"].(map[string]interface{}); ok {
				healthStatus, _ = health["status"].(string)
			}
			if sync, ok := status["sync"].(map[string]interface{}); ok {
				syncStatus, _ = sync["status"].(string)
			}
		}
	}

	// Check alloy deployment pods in monitoring namespace
	depGVR := schema.GroupVersionResource{
		Group:    "apps",
		Version:  "v1",
		Resource: "deployments",
	}
	depResource := dynamicClient.Resource(depGVR).Namespace("monitoring")

	componentStatus := make(map[string]interface{})
	allPodsReady := true
	totalReady := int64(0)
	totalCount := int64(0)

	deploys, depErr := depResource.List(context.TODO(), metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/name=alloy",
	})
	if depErr == nil && len(deploys.Items) > 0 {
		for _, dep := range deploys.Items {
			name := dep.GetName()
			readyReplicas := int64(0)
			totalReplicas := int64(1)
			if spec, ok := dep.Object["spec"].(map[string]interface{}); ok {
				if r, ok := spec["replicas"].(int64); ok {
					totalReplicas = r
				}
			}
			if st, ok := dep.Object["status"].(map[string]interface{}); ok {
				if available, ok := st["availableReplicas"].(int64); ok {
					readyReplicas = available
				}
			}
			isDepReady := readyReplicas >= totalReplicas && totalReplicas > 0
			if !isDepReady {
				allPodsReady = false
			}
			totalReady += readyReplicas
			totalCount += totalReplicas

			componentStatus[name] = map[string]interface{}{
				"ready":         isDepReady,
				"readyReplicas": readyReplicas,
				"totalReplicas": totalReplicas,
			}
		}
	} else {
		allPodsReady = false
	}

	syncOk := syncStatus == "Synced" || syncStatus == "" || syncStatus == "Progressing"
	appIsHealthy := healthStatus == "Healthy" || healthStatus == ""
	isReady := (appIsHealthy || syncOk) && allPodsReady && totalCount > 0

	// If nothing exists at all, report as not deployed (not error/failed)
	if !configMapExists && !appExists {
		return map[string]interface{}{
			"ready":   false,
			"message": "Not deployed yet",
		}
	}

	return map[string]interface{}{
		"ready":      isReady,
		"health":     healthStatus,
		"syncStatus": syncStatus,
		"totalReady": totalReady,
		"totalCount": totalCount,
		"lokiURL":    lokiURL,
		"configMap":  configMapExists,
		"appCR":      appExists,
		"message":    fmt.Sprintf("Health: %s | Sync: %s | Pods: %d/%d", healthStatus, syncStatus, totalReady, totalCount),
		"components": componentStatus,
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// applyRemoteYAML fetches YAML from a URL and applies it to the cluster via the k8s SDK.
// Returns combined output string and any error (continues on partial failures).
func applyRemoteYAML(url, namespace string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to fetch %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("HTTP %d from %s: %s", resp.StatusCode, url, string(body))
	}

	yamlBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response from %s: %w", url, err)
	}

	if err := k8s.ApplyYAMLToCluster(string(yamlBytes), namespace); err != nil {
		return string(yamlBytes), err
	}
	return string(yamlBytes), nil
}

// validateS3Bucket checks that S3 credentials can access a bucket using AWS SDK v2.
func validateS3Bucket(bucket, region, accessKeyID, secretAccessKey string) error {
	cfg, err := config.AWSConfig(accessKeyID, secretAccessKey, region)
	if err != nil {
		return fmt.Errorf("failed to create AWS config: %w", err)
	}

	svc := config.NewS3Client(cfg)
	ctx := context.TODO()
	_, err = svc.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &bucket})
	return err
}
