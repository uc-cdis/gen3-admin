package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/uc-cdis/gen3-admin/internal/helm"
	"github.com/uc-cdis/gen3-admin/internal/k8s"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/transport"
)

var (
	agentName            string
	agentCertFile        string
	agentKeyFile         string
	lastStatusUpdate     time.Time
	statusUpdateInterval time.Duration
	stream               pb.TunnelService_ConnectClient
	grpcServerURL        = "localhost:50051"
	kubeconfig           = "~/.kube/config"
)

const (
	defaultGRPCServerURL        = "localhost:50051"
	defaultStatusUpdateInterval = 30 * time.Second
)

type Agent struct {
	Name                 string
	Certificate          string
	Version              string
	client               pb.TunnelServiceClient
	stream               pb.TunnelService_ConnectClient
	statusUpdateInterval time.Duration
}

func init() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to get home directory")
	}
	kubeconfig = filepath.Join(homeDir, ".kube", "config")

	flag.StringVar(&agentName, "name", "", "Name of the agent")
	flag.DurationVar(&statusUpdateInterval, "status-interval", defaultStatusUpdateInterval, "Interval for sending status updates")
	flag.StringVar(&grpcServerURL, "server-address", defaultGRPCServerURL, "Address of the GRPC server")
	flag.StringVar(&kubeconfig, "kubeconfig", kubeconfig, "Path to kubeconfig file")
	flag.Parse()

	if agentName == "" {
		log.Fatal().Msg("Agent name is required")
	}

	agentCertFile = "certs/" + agentName + ".crt"
	agentKeyFile = "certs/" + agentName + ".key"
}

func NewAgent(name, version, serverAddress string, statusInterval time.Duration) (*Agent, error) {
	cert, err := tls.LoadX509KeyPair(agentCertFile, agentKeyFile)
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
	ticker := time.NewTicker(statusUpdateInterval)
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
		httpReq.Header.Set(k, v)
	}

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

	log.Debug().Msg("Sending proxy response")
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
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
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
	log.Debug().Msgf("Handling k8s proxy request: %v", req.Path)
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
	log.Debug().Msg("Creating request to url: " + url)
	httpReq, err := http.NewRequest(req.Method, url, nil)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create request")
		a.sendErrorResponse(req.StreamId, fmt.Errorf("failed to create request: %v", err))
		return
	}

	// Set headers
	// for k, v := range req.Headers {
	// 	log.Debug().Msg(fmt.Sprintf("Setting header %s to %s", k, v))
	// 	httpReq.Header.Set(k, v)
	// }

	// Set content type if needed
	httpReq.Header.Set("Content-Type", "application/json")

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

	log.Debug().Msgf("Response Status: %s", resp.Status)
	defer resp.Body.Close()

	// Print all response headers to debug log
	for k, v := range resp.Header {
		log.Debug().Msgf("Response Header: %s: %s", k, v)
	}

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
			log.Debug().Msg("Request completed - EOF")
			break
		}
		if err != nil {
			log.Error().Err(err).Msg("Error reading response body")
			break
		}
	}

	log.Debug().Msg("Request completed")
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
	argoCDApps, err := k8s.ListArgoCDApplications(context.TODO())
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
		case *pb.ServerMessage_Proxy:
			if content.Proxy.ProxyType == "k8s" {
				log.Debug().Msg("Got a k8s proxy request message")
				log.Debug().Msg(fmt.Sprintf("Content: %v", content.Proxy))
				go a.handleK8sProxyRequest(content.Proxy)
			} else {
				log.Debug().Msg("Got a non k8s proxy request message")
				go a.handleProxyRequest(content.Proxy)
			}
		case *pb.ServerMessage_Registration:
			log.Info().Msgf("Registration response: %v", content.Registration.Success)
		case *pb.ServerMessage_Status:
			log.Info().Msgf("Received server status: CPU: %v, Memory: %v", content.Status.CpuUsage, content.Status.MemoryUsage)
		default:
			log.Warn().Msgf("Unknown message type: %T", content)
		}
	}
}

func main() {
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	zerolog.SetGlobalLevel(zerolog.DebugLevel)
	log.Logger = log.With().Caller().Logger()

	agent, err := NewAgent(agentName, "1.0.0", grpcServerURL, statusUpdateInterval)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create agent")
	}

	ctx := context.Background()
	err = agent.Connect(ctx)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to server")
	}

	log.Info().Msg("Agent connected and running")
	err = agent.Run(ctx)
	if err != nil {
		log.Fatal().Err(err).Msg("Agent encountered an error")
	}
}
