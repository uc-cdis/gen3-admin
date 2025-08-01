package agentHelper

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/uc-cdis/gen3-admin/internal/argocd"
	"github.com/uc-cdis/gen3-admin/internal/helm"
	"github.com/uc-cdis/gen3-admin/internal/k8s"
	"github.com/uc-cdis/gen3-admin/internal/tunnel"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/transport"
)

var (
	AgentName            string
	AgentCertFile        string
	AgentKeyFile         string
	lastStatusUpdate     time.Time
	StatusUpdateInterval time.Duration
	stream               pb.TunnelService_ConnectClient
	GrpcServerURL        = "localhost:50051"
	Kubeconfig           = "~/.kube/config"
)

const (
	DefaultGRPCServerURL        = "localhost:50051"
	DefaultStatusUpdateInterval = 30 * time.Second
)

type Agent struct {
	Name                 string
	Certificate          string
	Version              string
	client               pb.TunnelServiceClient
	stream               pb.TunnelService_ConnectClient
	statusUpdateInterval time.Duration
}

var activeShells sync.Map

// Helper function to get secret keys for debugging
func getSecretKeys(secret *corev1.Secret) []string {
	keys := make([]string, 0, len(secret.Data))
	for k := range secret.Data {
		keys = append(keys, k)
	}
	return keys
}

func NewAgent(name, version, serverAddress string, statusInterval time.Duration) (*Agent, error) {
	cert, err := tls.LoadX509KeyPair(AgentCertFile, AgentKeyFile)
	if err != nil {
		return nil, fmt.Errorf("error loading client certificates: %v", err)
	}
	certPool := x509.NewCertPool()
	// TODO: Load CA location from config
	ca, err := os.ReadFile("certs/ca.crt")
	if err != nil {
		return nil, fmt.Errorf("could not read ca certificate: %s", err)
	}
	if ok := certPool.AppendCertsFromPEM(ca); !ok {
		return nil, fmt.Errorf("failed to append ca certs")
	}

	creds := credentials.NewTLS(&tls.Config{
		ServerName:   "csoc.gen3.org", // Replace with your actual server name
		Certificates: []tls.Certificate{cert},
		RootCAs:      certPool,
	})

	conn, err := grpc.Dial(serverAddress, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %v", err)
	}

	// stringCert := cert.Certificate[0]
	// certPEM := string(stringCert)
	// log.Debug().Msgf("Certificate: %s", certPEM)

	client := pb.NewTunnelServiceClient(conn)
	return &Agent{
		Name:                 name,
		Version:              version,
		client:               client,
		statusUpdateInterval: statusInterval,
	}, nil
}

func (a *Agent) Connect(ctx context.Context) error {
	var err error
	for {
		a.stream, err = a.client.Connect(ctx)
		if err != nil {
			if status.Code(err) == codes.Unavailable {
				log.Warn().Err(err).Msg("Server unavailable, retrying in 5 seconds...")
				time.Sleep(5 * time.Second)
				continue
			}
			return fmt.Errorf("error establishing stream: %v", err)
		}
		log.Info().Msg("Established connection with the server")

		err = a.stream.Send(&pb.AgentMessage{
			Message: &pb.AgentMessage_Registration{
				Registration: &pb.RegistrationRequest{
					AgentName:    a.Name,
					AgentVersion: a.Version,
				},
			},
		})
		if err != nil {
			log.Error().Err(err).Msg("Error sending registration request")
			continue
		}
		break
	}

	return nil
}

func (a *Agent) collectAgentStatus() *pb.StatusUpdate {
	cpuPercent, err := cpu.Percent(0, false)
	if err != nil {
		log.Error().Err(err).Msg("Error getting CPU usage")
		cpuPercent = []float64{0}
	}

	vmStat, err := mem.VirtualMemory()
	if err != nil {
		log.Error().Err(err).Msg("Error getting memory usage")
	}

	// Get the provider and k8s version
	k8sInfo, err := k8s.GetInfo()
	if err != nil {
		log.Error().Err(err).Msg("Error getting k8s info")
		return &pb.StatusUpdate{
			CpuUsage:     cpuPercent[0],
			MemoryUsage:  vmStat.UsedPercent,
			HealthStatus: "ERROR",
			Provider:     "ERROR",
			K8SVersion:   "ERROR",
		}
	}

	// log.Debug().Msgf("Collected followin metrics: CPU: %v, Memory: %v, Provider: %s, K8s Version: %s", cpuPercent, vmStat.UsedPercent, k8sInfo.Provider, k8sInfo.Version)

	return &pb.StatusUpdate{
		CpuUsage:     cpuPercent[0],
		MemoryUsage:  vmStat.UsedPercent,
		HealthStatus: "OK",
		Provider:     k8sInfo.Provider,
		K8SVersion:   k8sInfo.Version,
	}
}

func (a *Agent) sendStatusUpdates(ctx context.Context) {
	log.Debug().Msg("Sending status updates")
	ticker := time.NewTicker(StatusUpdateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			status := a.collectAgentStatus()
			err := a.stream.Send(&pb.AgentMessage{
				Message: &pb.AgentMessage_Status{
					Status: status,
				},
			})
			if err != nil {
				log.Error().Err(err).Msg("Error sending status update")
			}
			lastStatusUpdate = time.Now()
		case <-ctx.Done():
			return
		}
	}
}

func (a *Agent) handleProxyRequest(req *pb.ProxyRequest) {
	log.Debug().Msgf("Handling proxy request: %v", req)
	if req.Method == "CANCEL" {
		log.Info().Msgf("Received cancellation for stream ID: %s", req.StreamId)
		// Implement cancellation logic here
		return
	}

	// Create HTTP request
	httpReq, err := http.NewRequest(req.Method, req.Path, nil)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create request")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to create request: %v", err))
		return
	}

	// Set headers
	for k, v := range req.Headers {
		log.Warn().Str("key", k).Str("value", v).Msg("Setting request header")
		httpReq.Header.Set(k, v)
	}

	// Print headers

	// Execute request
	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Error().Err(err).Msgf("Failed to execute request: %v", err)
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to execute request: %v", err))
		return
	}
	defer resp.Body.Close()

	// Send headers
	// a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_HEADERS, 0, httpReq.Header, nil)

	// Send status code and headers
	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_HEADERS, int32(resp.StatusCode), resp.Header, nil)

	// Send body in chunks
	buffer := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(buffer)
		if n > 0 {
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, buffer[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Error().Err(err).Msg("Error reading response body")
			break
		}
	}

	// Send end of response
	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_END, 0, nil, nil)
}

func (a *Agent) sendProxyResponse(streamID string, status pb.ProxyResponseType, statusCode int32, headers http.Header, body []byte) error {
	resp := &pb.ProxyResponse{
		StreamId:   streamID,
		Status:     status,
		StatusCode: statusCode,
		Headers:    make(map[string]string),
		Body:       body,
	}

	for k, v := range headers {
		resp.Headers[k] = v[0]
	}

	// log.Debug().Msg("Sending proxy response")
	err := a.stream.Send(&pb.AgentMessage{
		Message: &pb.AgentMessage_Proxy{
			Proxy: resp,
		},
	})
	if err != nil {
		log.Error().Err(err).Msg("Failed to send proxy response")
		return err
	}
	return nil
}

func (a *Agent) sendErrorResponse(streamID string, err error) error {
	resp := &pb.ProxyResponse{
		StreamId:   streamID,
		Status:     pb.ProxyResponseType_ERROR,
		StatusCode: http.StatusInternalServerError,
		Headers:    map[string]string{"Content-Type": "text/plain"},
		Body:       []byte(err.Error()),
	}
	log.Debug().Msgf("Sending error response: %v", resp)
	sendErr := a.stream.Send(&pb.AgentMessage{
		Message: &pb.AgentMessage_Proxy{
			Proxy: resp,
		},
	})
	if sendErr != nil {
		log.Error().Err(sendErr).Msg("Failed to send error response")
		return err
	}
	return nil
}

type kubeContext struct {
	username   string
	serverURL  string
	serverCA   *x509.Certificate
	clientCert *tls.Certificate
	token      string
	insecure   bool
}

// KubeConfig defines a kubectl config file contents.  The structure maps the file format,
// so some of this is a little klunky.
type KubeConfig struct {
	APIVersion     string    `yaml:"apiVersion" json:"apiVersion"`
	Kind           string    `yaml:"kind" json:"kind"`
	CurrentContext string    `yaml:"current-context,omitempty" json:"current-context,omitempty"`
	Clusters       []Cluster `yaml:"clusters" json:"clusters"`
	Contexts       []Context `yaml:"contexts" json:"contexts"`
	Users          []User    `yaml:"users" json:"users"`
}

// Context associates a name with a ContextDetails.
type Context struct {
	Name    string         `yaml:"name" json:"name"`
	Context ContextDetails `yaml:"context" json:"context"`
}

// ContextDetails holds the names of the referenced cluster and user.
type ContextDetails struct {
	Cluster string `yaml:"cluster" json:"cluster"`
	User    string `yaml:"user" json:"user"`
}

// Cluster associates a name with a ClusterDetails.
type Cluster struct {
	Name    string         `yaml:"name" json:"name"`
	Cluster ClusterDetails `yaml:"cluster" json:"cluster"`
}

// ClusterDetails holds the certificate authority data, server name to connect to, and if we should
// skip TLS server identity verification.
type ClusterDetails struct {
	InsecureSkipTLSVerify    bool   `yaml:"insecure-skip-tls-verify,omitempty" json:"insecure-skip-tls-verify,omitempty"`
	CertificateAuthorityData string `yaml:"certificate-authority-data,omitempty" json:"certificate-authority-data,omitempty"`
	Server                   string `yaml:"server" json:"server"`
}

// User associates a name with a UserDetails.
type User struct {
	Name string      `yaml:"name" json:"name"`
	User UserDetails `yaml:"user" json:"user"`
}

// UserDetails holds the user's certificate information.
type UserDetails struct {
	ClientCertificateData string `yaml:"client-certificate-data" json:"client-certificate-data"`
	ClientKeyData         string `yaml:"client-key-data" json:"client-key-data"`
}

func getClientConfig() (*rest.Config, error) {
	// Check if running inside a Kubernetes cluster
	inClusterConfig, err := rest.InClusterConfig()
	if err == nil {
		return inClusterConfig, nil
	}

	// Fallback to kubeconfig
	config, err := clientcmd.BuildConfigFromFlags("", Kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("error building kubeconfig: %w", err)
	}

	// Explicitly create the transport
	transportConfig, err := config.TransportConfig()
	if err != nil {
		return nil, fmt.Errorf("error creating transport config: %w", err)
	}

	tr, err := transport.New(transportConfig)
	if err != nil {
		return nil, fmt.Errorf("error creating transport: %w", err)
	}

	// Set the transport in the config
	config.Transport = tr

	return config, nil

}

func (a *Agent) handleK8sProxyRequest(req *pb.ProxyRequest) {
	// log.Debug().Msgf("Handling k8s proxy request: %v", req.Path)
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	// log.Debug().Msgf("Handling k8s proxy request: %v", req)
	if req.Method == "CANCEL" {
		log.Info().Msgf("Received cancellation for stream ID: %s", req.StreamId)
		// Implement cancellation logic here
		return
	}

	// Setup k8s auth
	restConfig, err := k8s.GetConfig()
	if err != nil {
		log.Error().Err(err).Msg("Failed to setup k8s auth")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to setup k8s auth: %v", err))
		return
	}

	// Create HTTP request
	// Remove the last slash from the host
	host := strings.TrimSuffix(restConfig.Host, "/")
	url := fmt.Sprintf("%s%s", host, req.Path)
	// url := fmt.Sprintf("%s%s", restConfig.Host, req.Path)
	// log.Debug().Msg("Creating request to url: " + url)

	bodyReader := bytes.NewReader(req.Body)
	httpReq, err := http.NewRequest(req.Method, url, bodyReader)

	// httpReq, err := http.NewRequest(req.Method, url, nil)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create request")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to create request: %v", err))
		return
	}

	// // Set headers
	// for k, v := range req.Headers {
	// 	log.Debug().Msg(fmt.Sprintf("Setting header %s to %s", k, v))
	// 	httpReq.Header.Set(k, v)
	// }

	// // Set content type if needed
	// // httpReq.Header.Set("Content-Type", "application/json")

	// Set Content-Type header from req.Headers if present; else fallback to application/json
	if contentType, ok := req.Headers["Content-Type"]; ok {
		log.Debug().Msg(fmt.Sprintf("Setting Content-Type header to %s", contentType))
		httpReq.Header.Set("Content-Type", contentType)
	} else {
		// log.Debug().Msg("Content-Type header not found in request headers, defaulting to application/json")
		httpReq.Header.Set("Content-Type", "application/json")
	}

	// Set up the transport using the REST configuration
	transport, err := rest.TransportFor(restConfig)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get transport for REST config")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to get transport for REST config: %v", err))
		return
	}

	// Type assert to get TLSClientConfig
	if t, ok := transport.(*http.Transport); ok {
		if t.TLSClientConfig == nil {
			t.TLSClientConfig = &tls.Config{}
		}
		t.TLSClientConfig.NextProtos = []string{"h2", "http/1.1"}
	}

	// Execute request
	client := &http.Client{
		Transport: transport,
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Error().Err(err).Msgf("Failed to execute request: %v", err)
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to execute request: %v", err))
		return
	}

	// log.Debug().Msgf("Response Status: %s", resp.Status)
	defer resp.Body.Close()

	// Print all response headers to debug log
	// for k, v := range resp.Header {
	// 	log.Debug().Msgf("Response Header: %s: %s", k, v)
	// }

	// // Send headers
	// a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_HEADERS, 0, httpReq.Header, nil)

	// Send status code and headers
	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_HEADERS, int32(resp.StatusCode), resp.Header, nil)

	// readBody, err := io.ReadAll(resp.Body)
	// if err != nil {
	// 	log.Error().Err(err).Msg("Error reading response body")
	// 	return
	// }

	buffer := make([]byte, 16384)
	for {
		n, err := resp.Body.Read(buffer)
		if n > 0 {
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, buffer[:n])
		}
		if err == io.EOF {
			// log.Debug().Msg("Request completed - EOF")
			break
		}
		if err != nil {
			log.Error().Err(err).Msg("Error reading response body")
			break
		}
	}

	// log.Debug().Msg("Request completed")
	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_END, 0, nil, nil)
}

func (a *Agent) handleProjectsRequest(req *pb.ProjectsRequest) {
	log.Debug().Msg("Handling projects request for stream ID: " + req.StreamId)

	// gather all helm deployments
	helmDeployments, err := helm.ListAllHelmReleases()
	if err != nil {
		log.Error().Err(err).Msg("Error listing helm deployments")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error listing helm deployments: %v", err))
		return
	}

	// Get all ArgoCD applications
	argoCDApps, err := argocd.ListArgoCDApplications(context.TODO())
	if err != nil {
		log.Error().Err(err).Msg("Error listing ArgoCD applications")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error listing ArgoCD applications: %v", err))
		return
	}

	var helmDeploymentsJSON []byte
	helmDeploymentsJSON, err = json.Marshal(helmDeployments)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling helm deployments")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error marshaling helm deployments: %v", err))
		return
	}

	var argoCDAppsJSON []byte
	argoCDAppsJSON, err = json.Marshal(argoCDApps)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling ArgoCD applications")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error marshaling ArgoCD applications: %v", err))
		return
	}

	// Unmarshal both JSON arrays into slices of map[string]interface{}
	var helmDeploymentsInterface []map[string]interface{}
	var argoCDAppsInterface []map[string]interface{}

	err = json.Unmarshal(helmDeploymentsJSON, &helmDeploymentsInterface)
	if err != nil {
		log.Error().Err(err).Msg("Error unmarshaling helm deployments")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error unmarshaling helm deployments: %v", err))
		return
	}

	err = json.Unmarshal(argoCDAppsJSON, &argoCDAppsInterface)
	if err != nil {
		log.Error().Err(err).Msg("Error unmarshaling ArgoCD applications")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error unmarshaling ArgoCD applications: %v", err))
		return
	}

	// Combine the two slices into a single slice of map[string]interface{}
	combinedInterface := append(helmDeploymentsInterface, argoCDAppsInterface...)

	combinedJSON, err := json.Marshal(combinedInterface)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling combined JSON")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error marshaling combined JSON: %v", err))
		return
	}

	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, combinedJSON)

	// a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, helmDeploymentsJSON)

}

func (a *Agent) handleDbUiRequest(req *pb.DbUiRequest) {
	ctx := context.Background()

	// Set defaults
	namespace := req.Namespace
	if namespace == "" {
		namespace = "default"
	}

	log.Info().Msgf("Launching %s UI for database: %s in namespace: %s", req.DbType, req.DbName, namespace)

	config, err := k8s.GetConfig()
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Error().Msg("Error in getting clientset")
		a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_ERROR, 404, nil,
			[]byte(fmt.Sprintf(`{"success": false, "message": "Error in clientset: %v"}`, err)))
		return
	}

	if req.DbType == "elasticsearch" {
		a.handleElasticsearchUI(ctx, clientset, req)
	} else {
		// Default to PostgreSQL (pgweb)
		a.handlePostgresUI(ctx, clientset, req)
	}
}

func (a *Agent) handleElasticsearchUI(ctx context.Context, clientset kubernetes.Interface, req *pb.DbUiRequest) {
	port := int32(5601) // OpenSearch Dashboards default port
	podName := fmt.Sprintf("opensearch-dashboards-%s", req.DbName)
	serviceName := fmt.Sprintf("opensearch-dashboards-%s-service", req.DbName)

	// Elasticsearch service URL (adjust this to match your ES service name)
	elasticsearchURL := fmt.Sprintf("http://%s:9200", req.DbName)

	// Check if pod already exists and is running
	existingPod, err := clientset.CoreV1().Pods(req.Namespace).Get(ctx, podName, metav1.GetOptions{})
	if err == nil {
		if existingPod.Status.Phase == corev1.PodRunning {
			log.Info().Msgf("OpenSearch Dashboards pod %s already exists and is running", podName)
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 200, nil,
				[]byte(fmt.Sprintf(`{
					"success": true,
					"message": "OpenSearch Dashboards pod already running",
					"pod_name": "%s",
					"service_name": "%s",
					"namespace": "%s",
					"db_name": "%s",
					"port": %d,
					"status": "already_running",
					"db_type": "elasticsearch"
				}`, podName, serviceName, req.Namespace, req.DbName, port)))
			return
		} else if existingPod.Status.Phase == corev1.PodFailed {
			log.Info().Msgf("OpenSearch Dashboards pod %s exists but failed, deleting and recreating", podName)
			clientset.CoreV1().Pods(req.Namespace).Delete(ctx, podName, metav1.DeleteOptions{})
		} else {
			log.Info().Msgf("OpenSearch Dashboards pod %s already exists with status: %s", podName, existingPod.Status.Phase)
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 200, nil,
				[]byte(fmt.Sprintf(`{
					"success": true,
					"message": "OpenSearch Dashboards pod already exists",
					"pod_name": "%s",
					"service_name": "%s",
					"namespace": "%s",
					"db_name": "%s",
					"port": %d,
					"status": "%s",
					"db_type": "elasticsearch"
				}`, podName, serviceName, req.Namespace, req.DbName, port, existingPod.Status.Phase)))
			return
		}
	}

	// Create OpenSearch Dashboards configuration
	dashboardsConfig := fmt.Sprintf(`
# OpenSearch Dashboards configuration
server.host: "0.0.0.0"
server.port: 5601

# Elasticsearch configuration
opensearch.hosts: ["%s"]

# Disable security for simplicity (adjust as needed)
opensearch.ssl.verificationMode: none
opensearch.username: ""
opensearch.password: ""

# Security plugin disabled
opensearch_security.multitenancy.enabled: false
opensearch_security.readonly_mode.roles: []

# CORS settings
server.cors.enabled: true
server.cors.allowOrigin: "*"
server.cors.allowHeaders: ["Authorization", "Content-Type", "If-None-Match", "kbn-version", "kbn-xsrf"]

# Telemetry
telemetry.enabled: false
telemetry.optIn: false

# Logging
logging.silent: false
logging.verbose: false
`, elasticsearchURL)

	// Create ConfigMap for OpenSearch Dashboards configuration
	configMapName := fmt.Sprintf("opensearch-dashboards-config-%s", req.DbName)
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      configMapName,
			Namespace: req.Namespace,
			Labels: map[string]string{
				"app":        "opensearch-dashboards",
				"db-name":    req.DbName,
				"managed-by": "tunnel-agent",
			},
		},
		Data: map[string]string{
			"opensearch_dashboards.yml": dashboardsConfig,
		},
	}

	// Create or update ConfigMap
	_, err = clientset.CoreV1().ConfigMaps(req.Namespace).Get(ctx, configMapName, metav1.GetOptions{})
	if err != nil {
		_, err = clientset.CoreV1().ConfigMaps(req.Namespace).Create(ctx, configMap, metav1.CreateOptions{})
		if err != nil {
			log.Error().Err(err).Msg("Failed to create OpenSearch Dashboards config map")
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_ERROR, 500, nil,
				[]byte(fmt.Sprintf(`{"success": false, "message": "Failed to create OpenSearch Dashboards config map: %v"}`, err)))
			return
		}
	} else {
		_, err = clientset.CoreV1().ConfigMaps(req.Namespace).Update(ctx, configMap, metav1.UpdateOptions{})
		if err != nil {
			log.Error().Err(err).Msg("Failed to update OpenSearch Dashboards config map")
		}
	}

	// Create OpenSearch Dashboards pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: req.Namespace,
			Labels: map[string]string{
				"app":        "opensearch-dashboards",
				"db-name":    req.DbName,
				"db-type":    "elasticsearch",
				"managed-by": "tunnel-agent",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "opensearch-dashboards",
					Image: "opensearchproject/opensearch-dashboards:2.11.1",
					Ports: []corev1.ContainerPort{
						{
							ContainerPort: port,
							Protocol:      corev1.ProtocolTCP,
						},
					},
					Env: []corev1.EnvVar{
						{
							Name:  "OPENSEARCH_HOSTS",
							Value: elasticsearchURL,
						},
						{
							Name:  "DISABLE_SECURITY_DASHBOARDS_PLUGIN",
							Value: "true",
						},
					},
					// VolumeMounts: []corev1.VolumeMount{
					// 	{
					// 		Name:      "config",
					// 		MountPath: "/usr/share/opensearch-dashboards/config/opensearch_dashboards.yml",
					// 		SubPath:   "opensearch_dashboards.yml",
					// 	},
					// },
					ReadinessProbe: &corev1.Probe{
						ProbeHandler: corev1.ProbeHandler{
							HTTPGet: &corev1.HTTPGetAction{
								Path: "/api/status",
								Port: intstr.FromInt(int(port)),
							},
						},
						InitialDelaySeconds: 30,
						PeriodSeconds:       15,
						TimeoutSeconds:      10,
					},
					LivenessProbe: &corev1.Probe{
						ProbeHandler: corev1.ProbeHandler{
							HTTPGet: &corev1.HTTPGetAction{
								Path: "/api/status",
								Port: intstr.FromInt(int(port)),
							},
						},
						InitialDelaySeconds: 60,
						PeriodSeconds:       30,
						TimeoutSeconds:      10,
					},
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceMemory: resource.MustParse("512Mi"),
							corev1.ResourceCPU:    resource.MustParse("100m"),
						},
						Limits: corev1.ResourceList{
							corev1.ResourceMemory: resource.MustParse("1Gi"),
							corev1.ResourceCPU:    resource.MustParse("500m"),
						},
					},
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "config",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{
								Name: configMapName,
							},
						},
					},
				},
			},
			RestartPolicy: corev1.RestartPolicyAlways,
		},
	}

	// Add any additional labels from request
	for k, v := range req.Labels {
		pod.ObjectMeta.Labels[k] = v
	}

	// Create the pod
	log.Info().Msgf("Creating OpenSearch Dashboards pod: %s", podName)
	createdPod, err := clientset.CoreV1().Pods(req.Namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		log.Error().Err(err).Msg("Failed to create OpenSearch Dashboards pod")
		a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_ERROR, 500, nil,
			[]byte(fmt.Sprintf(`{"success": false, "message": "Failed to create OpenSearch Dashboards pod: %v"}`, err)))
		return
	}

	log.Info().Msgf("OpenSearch Dashboards pod %s created successfully", createdPod.Name)

	// Create or update the service
	a.createOrUpdateService(ctx, clientset, req, serviceName, port, "opensearch-dashboards")
}

func (a *Agent) handlePostgresUI(ctx context.Context, clientset kubernetes.Interface, req *pb.DbUiRequest) {
	port := int32(8081)
	secretName := fmt.Sprintf("%s-dbcreds", req.DbName)
	podName := fmt.Sprintf("pgweb-%s", req.DbName)
	serviceName := fmt.Sprintf("pgweb-%s-service", req.DbName)

	// Check if secret exists for PostgreSQL
	secret, err := clientset.CoreV1().Secrets(req.Namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		log.Error().Err(err).Msgf("Secret %s not found", secretName)
		a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 404, nil,
			[]byte(fmt.Sprintf(`{"success": false, "message": "Secret %s not found: %v"}`, secretName, err)))
		return
	}

	log.Debug().Msgf("Found secret %s with keys: %v", secretName, getSecretKeys(secret))

	// Check if pod already exists and is running
	existingPod, err := clientset.CoreV1().Pods(req.Namespace).Get(ctx, podName, metav1.GetOptions{})
	if err == nil {
		if existingPod.Status.Phase == corev1.PodRunning {
			log.Info().Msgf("PgWeb pod %s already exists and is running", podName)
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 200, nil,
				[]byte(fmt.Sprintf(`{
					"success": true,
					"message": "PgWeb pod already running",
					"pod_name": "%s",
					"service_name": "%s",
					"namespace": "%s",
					"db_name": "%s",
					"port": %d,
					"status": "already_running",
					"secret_found": true,
					"secret_keys": %s,
					"db_type": "postgresql"
				}`, podName, serviceName, req.Namespace, req.DbName, port,
					fmt.Sprintf(`["%s"]`, strings.Join(getSecretKeys(secret), `", "`)))))
			return
		} else if existingPod.Status.Phase == corev1.PodFailed {
			log.Info().Msgf("PgWeb pod %s exists but failed, deleting and recreating", podName)
			clientset.CoreV1().Pods(req.Namespace).Delete(ctx, podName, metav1.DeleteOptions{})
		} else {
			log.Info().Msgf("PgWeb pod %s already exists with status: %s", podName, existingPod.Status.Phase)
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 200, nil,
				[]byte(fmt.Sprintf(`{
					"success": true,
					"message": "PgWeb pod already exists",
					"pod_name": "%s",
					"service_name": "%s",
					"namespace": "%s",
					"db_name": "%s",
					"port": %d,
					"status": "%s",
					"secret_found": true,
					"secret_keys": %s,
					"db_type": "postgresql"
				}`, podName, serviceName, req.Namespace, req.DbName, port, existingPod.Status.Phase,
					fmt.Sprintf(`["%s"]`, strings.Join(getSecretKeys(secret), `", "`)))))
			return
		}
	}

	// Create PgWeb pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: req.Namespace,
			Labels: map[string]string{
				"app":        "pgweb",
				"db-name":    req.DbName,
				"db-type":    "postgresql",
				"managed-by": "tunnel-agent",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "pgweb",
					Image: "sosedoff/pgweb:latest",
					Ports: []corev1.ContainerPort{
						{
							ContainerPort: port,
							Protocol:      corev1.ProtocolTCP,
						},
					},
					Env: []corev1.EnvVar{
						{
							Name: "PGHOST",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
									Key:                  "host",
								},
							},
						},
						{
							Name: "PGPORT",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
									Key:                  "port",
								},
							},
						},
						{
							Name: "PGUSER",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
									Key:                  "username",
								},
							},
						},
						{
							Name: "PGPASSWORD",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
									Key:                  "password",
								},
							},
						},
						{
							Name: "PGDATABASE",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
									Key:                  "database",
								},
							},
						},
						{
							Name:  "PGWEB_BIND_HOST",
							Value: "0.0.0.0",
						},
						{
							Name:  "PGWEB_LISTEN_PORT",
							Value: fmt.Sprintf("%d", port),
						},
						{
							Name:  "PGWEB_DATABASE_URL",
							Value: "postgres://$(PGUSER):$(PGPASSWORD)@$(PGHOST):$(PGPORT)/$(PGDATABASE)?sslmode=disable",
						},
					},
					ReadinessProbe: &corev1.Probe{
						ProbeHandler: corev1.ProbeHandler{
							HTTPGet: &corev1.HTTPGetAction{
								Path: "/",
								Port: intstr.FromInt(int(port)),
							},
						},
						InitialDelaySeconds: 5,
						PeriodSeconds:       10,
					},
					LivenessProbe: &corev1.Probe{
						ProbeHandler: corev1.ProbeHandler{
							HTTPGet: &corev1.HTTPGetAction{
								Path: "/",
								Port: intstr.FromInt(int(port)),
							},
						},
						InitialDelaySeconds: 15,
						PeriodSeconds:       20,
					},
				},
			},
			RestartPolicy: corev1.RestartPolicyAlways,
		},
	}

	// Add any additional labels from request
	for k, v := range req.Labels {
		pod.ObjectMeta.Labels[k] = v
	}

	// Create the pod
	log.Info().Msgf("Creating PgWeb pod: %s", podName)
	createdPod, err := clientset.CoreV1().Pods(req.Namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		log.Error().Err(err).Msg("Failed to create PgWeb pod")
		a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_ERROR, 500, nil,
			[]byte(fmt.Sprintf(`{"success": false, "message": "Failed to create PgWeb pod: %v"}`, err)))
		return
	}

	log.Info().Msgf("PgWeb pod %s created successfully", createdPod.Name)

	// Create or update the service
	a.createOrUpdateService(ctx, clientset, req, serviceName, port, "pgweb")
}

func (a *Agent) createOrUpdateService(ctx context.Context, clientset kubernetes.Interface, req *pb.DbUiRequest, serviceName string, port int32, appType string) {
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      serviceName,
			Namespace: req.Namespace,
			Labels: map[string]string{
				"app":        appType,
				"db-name":    req.DbName,
				"db-type":    req.DbType,
				"managed-by": "tunnel-agent",
			},
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{
				"app":     appType,
				"db-name": req.DbName,
			},
			Ports: []corev1.ServicePort{
				{
					Name:       "http",
					Port:       port,
					TargetPort: intstr.FromInt(int(port)),
					Protocol:   corev1.ProtocolTCP,
				},
			},
			Type: corev1.ServiceTypeClusterIP,
		},
	}

	// Try to get existing service first
	existingService, err := clientset.CoreV1().Services(req.Namespace).Get(ctx, serviceName, metav1.GetOptions{})
	if err != nil {
		// Service doesn't exist, create it
		log.Info().Msgf("Creating service: %s", serviceName)
		createdService, err := clientset.CoreV1().Services(req.Namespace).Create(ctx, service, metav1.CreateOptions{})
		if err != nil {
			log.Error().Err(err).Msg("Failed to create service")
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_ERROR, 500, nil,
				[]byte(fmt.Sprintf(`{"success": false, "message": "Failed to create service: %v"}`, err)))
			return
		}
		log.Info().Msgf("Service %s created successfully", createdService.Name)
	} else {
		// Service exists, update it
		log.Info().Msgf("Updating existing service: %s", serviceName)
		existingService.Spec = service.Spec
		_, err = clientset.CoreV1().Services(req.Namespace).Update(ctx, existingService, metav1.UpdateOptions{})
		if err != nil {
			log.Error().Err(err).Msg("Failed to update service")
			a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_ERROR, 500, nil,
				[]byte(fmt.Sprintf(`{"success": false, "message": "Failed to update service: %v"}`, err)))
			return
		}
		log.Info().Msgf("Service %s updated successfully", serviceName)
	}

	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 200, nil,
		[]byte(fmt.Sprintf(`{
			"success": true,
			"message": "%s pod and service created successfully",
			"pod_name": "%s",
			"service_name": "%s",
			"namespace": "%s",
			"db_name": "%s",
			"port": %d,
			"status": "created",
			"db_type": "%s"
		}`, strings.Title(appType), fmt.Sprintf("%s-%s", appType, req.DbName), serviceName, req.Namespace, req.DbName, port, req.DbType)))
}

func (a *Agent) handleHelmValuesRequest(req *pb.HelmValuesRequest) {

	log.Debug().Msgf("Handling helm values request: %v", req)
	if req.Release == "" {
		log.Info().Msgf("Received helm values request for release: %s", req.Release)
		// Implement cancellation logic here
		return
	}

	helmValues, err := helm.ShowHelmValues(req.Release, req.Namespace)
	if err != nil {
		log.Error().Err(err).Msg("Error getting helm values")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error getting helm values: %v", err))
		return
	}

	responseJson, err := json.Marshal(helmValues)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling helm values")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error marshaling helm values: %v", err))
		return
	}

	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, responseJson)

}

func (a *Agent) handleHelmDeleteRequest(req *pb.HelmDeleteRequest) {

	log.Debug().Msgf("Handling helm delete request: %v", req)
	if req.Release == "" {
		log.Info().Msgf("Received helm delete request for release: %s", req.Release)
		// Implement cancellation logic here
		return
	}

	helmDelete, err := helm.DeleteHelmRelease(req.Release, req.Namespace)
	if err != nil {
		log.Error().Err(err).Msg("Error getting helm delete")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error getting helm delete: %v", err))
		return
	}

	log.Debug().Msgf("Helm delete response: %v", helmDelete)

	responseJson, err := json.Marshal(helmDelete)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling helm delete")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error marshaling helm delete: %v", err))
		return
	}

	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, responseJson)

}

func (a *Agent) handleHelmInstallRequest(req *pb.HelmInstallRequest) {
	log.Debug().Msgf("Handling helm install request: %v", req)

	var values map[string]interface{}
	err := json.Unmarshal(req.Values, &values)
	if err != nil {
		log.Error().Err(err).Msg("Error unmarshaling values")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error unmarshaling values: %v", err))
		return
	}

	installOps := helm.InstallOptions{
		RepoName:        req.Repo,
		RepoUrl:         req.RepoUrl,
		ChartName:       req.Chart,
		Version:         req.Version,
		ReleaseName:     req.Release,
		Namespace:       req.Namespace,
		Wait:            false,
		Timeout:         time.Minute * 5,
		CreateNamespace: true,
		Values:          values,
	}

	err = installOps.Validate()
	if err != nil {
		log.Error().Err(err).Msg("Error validating install options")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error validating install options: %v", err))
		return
	}

	log.Debug().Msgf("Install options: %v", installOps)

	install, err := helm.InstallHelmChart(installOps)
	if err != nil {
		log.Error().Err(err).Msg("Error installing chart")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error installing chart: %v", err))
		return
	}

	responseJson, err := json.Marshal(install)
	if err != nil {
		log.Error().Err(err).Msg("Error marshaling install response")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("error marshaling install response: %v", err))
		return
	}

	a.sendProxyResponse(req.StreamId, pb.ProxyResponseType_DATA, 0, nil, responseJson)
}

func (a *Agent) Run(ctx context.Context) error {
	go a.sendStatusUpdates(ctx)

	for {
		msg, err := a.stream.Recv()
		if err != nil {
			if err == io.EOF {
				log.Info().Msg("Server closed the connection")
				return nil
			}
			return fmt.Errorf("error receiving message from server: %v", err)
		}

		switch content := msg.Message.(type) {
		case *pb.ServerMessage_HelmDeleteRequest:
			log.Warn().Msg("Got a helm delete request message")
			go a.handleHelmDeleteRequest(content.HelmDeleteRequest)
		case *pb.ServerMessage_HelmInstallRequest:
			log.Warn().Msg("Got a helm install request message")
			go a.handleHelmInstallRequest(content.HelmInstallRequest)
		case *pb.ServerMessage_HelmValuesRequest:
			log.Warn().Msg("Got a helm values request message")
			go a.handleHelmValuesRequest(content.HelmValuesRequest)
		case *pb.ServerMessage_Projects:
			log.Debug().Msg("Got a projects request message")
			go a.handleProjectsRequest(content.Projects)
		case *pb.ServerMessage_DbuiRequest:
			log.Debug().Msgf("Got a DBUI request: %s", content)
			go a.handleDbUiRequest(content.DbuiRequest)
		case *pb.ServerMessage_Proxy:
			if content.Proxy.ProxyType == "k8s" {
				// log.Debug().Msg("Got a k8s proxy request message")
				// log.Debug().Msg(fmt.Sprintf("Content: %v", content.Proxy))
				go a.handleK8sProxyRequest(content.Proxy)
			} else {
				log.Debug().Msg("Got a non k8s proxy request message")
				go a.handleProxyRequest(content.Proxy)
			}
		case *pb.ServerMessage_Registration:
			if !content.Registration.Success {
				// This is used as a way to signal that the server is ending the connection. Let's die.
				log.Fatal().Msg("Connection killed by server, possibly a new agent connected. Exiting.")
			}
			log.Info().Msgf("Registration response: %v", content.Registration.Success)
		case *pb.ServerMessage_Status:
			log.Info().Msgf("Received server status: CPU: %v, Memory: %v", content.Status.CpuUsage, content.Status.MemoryUsage)
		// Terminal stream
		case *pb.ServerMessage_TerminalStream:
			log.Info().Msgf("Received terminal request from server.")
			go a.HandleTerminal(content.TerminalStream)
		default:
			log.Warn().Msgf("Unknown message type: %T", content)
		}
	}
}

func startShell(ctx context.Context, streamID string, stream pb.TunnelService_ConnectClient) {
	cmd := exec.CommandContext(ctx, "/bin/sh") // or "/bin/bash"
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to get stdin")
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to get stdout")
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to get stderr")
		return
	}

	if err := cmd.Start(); err != nil {
		log.Fatal().Err(err).Msg("failed to start shell")
		return
	}

	// Read output (stdout + stderr)
	go func() {
		reader := io.MultiReader(stdout, stderr)
		buf := make([]byte, 1024)
		for {
			n, err := reader.Read(buf)
			if err != nil {
				log.Info().Msg("shell closed output")
				return
			}
			stream.Send(&pb.AgentMessage{
				Message: &pb.AgentMessage_TerminalStream{
					TerminalStream: &pb.TerminalStream{
						SessionId: streamID,
						Data:      buf[:n],
					},
				},
			})
		}
	}()

	// Store stdin writer somewhere (e.g. in a map[streamID]io.WriteCloser) so you can write to it later
	activeShells.Store(streamID, stdin)

	// Wait until shell exits
	cmd.Wait()
	log.Info().Msg("Shell exited")
	activeShells.Delete(streamID)
}

func (a *Agent) HandleTerminal(ts *tunnel.TerminalStream) error {
	log.Info().Msgf("Starting shell for session: %s", ts.SessionId)
	ctx, _ := context.WithCancel(context.Background())

	// Start the shell in background
	go startShell(ctx, ts.SessionId, a.stream)

	a.stream.Send(&pb.AgentMessage{
		Message: &pb.AgentMessage_TerminalStream{
			TerminalStream: &pb.TerminalStream{
				Data:      []byte("Connected to"),
				SessionId: ts.SessionId,
			},
		},
	})

	log.Info().Msgf("Terminal stream message sent %s", ts.SessionId)
	return nil
}
