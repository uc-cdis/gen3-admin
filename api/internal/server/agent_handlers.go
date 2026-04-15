package server

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"html/template"
	"math/big"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/uc-cdis/gen3-admin/internal/ca"
	"github.com/uc-cdis/gen3-admin/internal/k8s"
	"github.com/uc-cdis/gen3-admin/internal/utils"
)

type Agent struct {
	Id              string    `json:"id"`
	Name            string    `json:"name"`
	Certificate     string    `json:"certificate"`
	Metadata        Metadata  `json:"metadata"`
	PrivateKey      string    `json:"private_key"`
	Connected       bool      `json:"connected"`
	LastSeen        time.Time `json:"lastSeen"`
	CpuUsage        float64   `json:"cpuUsage"`
	MemoryUsage     float64   `json:"memoryUsage"`
	Provider        string    `json:"provider"`
	K8sVersion      string    `json:"k8sVersion"`
	PodCapacity     int       `json:"podCapacity"`
	PodCount        int       `json:"podCount"`
	RoleARN         string    `json:"rolearn"`
	EKS             bool      `json:"eks"`
	AssumeMethod    string    `json:"assumemethod"`
	AccessKey       string    `json:"accesskey"`
	SecretAccessKey string    `json:"secretaccesskey"`
}

type Metadata struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type ServiceAccountData struct {
	EKS             bool
	RoleARN         string
	AssumeMethod    string
	AccessKey       string
	SecretAccessKey string
}

func generateAgentConfig(agentName string, roleArn string, eks bool, assumeMethod string, accessKey string, secretAccessKey string) (string, error) {
	caCert, caKey, err := ca.LoadOrCreateCA()
	if err != nil {
		return "", fmt.Errorf("error loading/creating CA: %v", err)
	}

	agentPrivKey, err := ecdsa.GenerateKey(CertCurve, rand.Reader)
	if err != nil {
		return "", fmt.Errorf("error generating agent key: %v", err)
	}

	id := uuid.New().String()

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit)
	if err != nil {
		return "", fmt.Errorf("failed to generate serial number:%v", err)
	}

	subjectAlternativeNames := []string{agentName, "csoc.gen3.org", "localhost"}

	agentCertTemplate := &x509.Certificate{
		SerialNumber: serialNumber,
		Subject:      pkix.Name{CommonName: agentName, SerialNumber: id},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().AddDate(1, 0, 0),
		DNSNames:     subjectAlternativeNames,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}

	agentCertBytes, err := x509.CreateCertificate(rand.Reader, agentCertTemplate, caCert, &agentPrivKey.PublicKey, caKey)
	if err != nil {
		return "", fmt.Errorf("error creating agent certificate: %v", err)
	}

	agentKeyBytes, err := x509.MarshalECPrivateKey(agentPrivKey)
	if err != nil {
		return "", fmt.Errorf("error marshaling agent key: %v", err)
	}

	agentCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: agentCertBytes})
	agentKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: agentKeyBytes})
	caCertPem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCert.Raw})

	utils.MustWriteFile("certs/"+agentName+".crt", []byte(agentCertPEM), 0644)
	utils.MustWriteFile("certs/"+agentName+".key", []byte(agentKeyPEM), 0600)

	log.Debug().Msgf("Certificate and key for agent %s dumped to file", agentName)

	AgentConnections[agentName] = &AgentConnection{
		stream: nil,
		agent: Agent{
			Name:        agentName,
			Id:          id,
			Certificate: string(agentCertPEM),
			Connected: false,
			RoleARN:   roleArn,
		},
	}

	config := fmt.Sprintf(`
---
apiVersion: v1
kind: Secret
metadata:
  name: csoc-tls
type: opaque
data:
  %s.crt: %s
  %s.key: %s
  ca.crt: %s`,
		agentName,
		base64.StdEncoding.EncodeToString(agentCertPEM),
		agentName,
		base64.StdEncoding.EncodeToString(agentKeyPEM),
		base64.StdEncoding.EncodeToString(caCertPem),
	)

	const saTemplate = `
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: csoc
  namespace: csoc
{{- if and .EKS (eq .AssumeMethod "role") }}
  annotations:
    eks.amazonaws.com/role-arn: {{ .RoleARN }}
{{- else if and .EKS (eq .AssumeMethod "user")}}
---
apiVersion: v1
kind: Secret
metadata:
  name: aws-creds
  namespace: csoc
type: Opaque
stringData:
  aws_access_key_id: {{ .AccessKey }}
  aws_secret_access_key: {{ .SecretAccessKey }}
{{- end }}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: csoc-agent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: csoc-agent
  template:
    metadata:
      labels:
        app: csoc-agent
    spec:
      serviceAccount: csoc
      containers:
        - name: agent
          image: quay.io/jawadqur/agent:latest
          command: ["agent"]
          args: ["--name", "%s"]
          {{- if and .EKS (eq .AssumeMethod "user") }}
          env:
            - name: AWS_REGION
              value: us-west-2
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: aws-creds
                  key: aws_access_key_id
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: aws-creds
                  key: aws_secret_access_key
          {{- end }}
          volumeMounts:
            - name: tls-certs
              mountPath: /app/gen3-agent/certs/
              readOnly: true
      volumes:
        - name: tls-certs
          secret:
            secretName: csoc-tls`

	saData := ServiceAccountData{
		EKS:             eks,
		RoleARN:         roleArn,
		AssumeMethod:    assumeMethod,
		AccessKey:       accessKey,
		SecretAccessKey: secretAccessKey,
	}

	var saBuffer bytes.Buffer

	tmpl, err := template.New("serviceaccount").Parse(saTemplate)
	if err != nil {
		return "", fmt.Errorf("error parsing template: %v", err)
	}

	err = tmpl.Execute(&saBuffer, saData)
	if err != nil {
		return "", fmt.Errorf("error executing template: %v", err)
	}

	config += saBuffer.String()
	config += fmt.Sprintf(`
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cluster-admin-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: csoc
    namespace: csoc
`)

	return strings.TrimSpace(config), nil
}

func CreateAgentHandler(c *gin.Context) {
	log.Info().Msg("CreateAgentHandler")
	r := c.Request
	w := c.Writer
	var requestData struct {
		Name            string `json:"name"`
		RoleARN         string `json:"rolearn"`
		EKS             bool   `json:"eks"`
		AssumeMethod    string `json:"assumemethod"`
		AccessKey       string `json:"accesskey"`
		SecretAccessKey string `json:"secretaccesskey"`
	}
	err := json.NewDecoder(r.Body).Decode(&requestData)
	if err != nil {
		log.Error().Err(err).Msg("Error decoding request data")
		http.Error(w, "Invalid registration data", http.StatusBadRequest)
		return
	}

	config, err := generateAgentConfig(requestData.Name, requestData.RoleARN, requestData.EKS, requestData.AssumeMethod, requestData.AccessKey, requestData.SecretAccessKey)
	if err != nil {
		log.Error().Err(err).Msg("Error generating agent config")
		http.Error(w, "Error generating agent config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(config))
}

func CreateLocalAgentHandler(c *gin.Context) {
	log.Info().Msg("CreateLocalAgentHandler - creating and deploying agent to local cluster")

	var requestData struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&requestData); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	if requestData.Name == "" {
		requestData.Name = "local-agent"
	}

	yamlManifest, err := generateAgentConfig(
		requestData.Name,
		"",
		false,
		"",
		"",
		"",
	)
	if err != nil {
		log.Error().Err(err).Msg("Error generating agent config for local agent")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate agent config: " + err.Error()})
		return
	}

	yamlManifest = strings.ReplaceAll(yamlManifest, "%s", requestData.Name)

	serverAddress := detectLocalServerAddress()
	yamlManifest = injectServerAddress(yamlManifest, serverAddress)

	err = k8s.ApplyYAMLToCluster(yamlManifest, "csoc")
	if err != nil {
		log.Error().Err(err).Msg("Failed to apply agent manifest to local cluster")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to deploy agent: " + err.Error()})
		return
	}

	log.Info().Msgf("Local agent %s deployed successfully to cluster", requestData.Name)
	c.JSON(http.StatusOK, gin.H{
		"message":       "Agent deployed successfully",
		"name":          requestData.Name,
		"serverAddress": serverAddress,
	})
}

func detectLocalServerAddress() string {
	return "csoc-api.csoc.svc:50051"
}

func injectServerAddress(yamlManifest string, serverAddress string) string {
	prefix := `args: ["--name", "`
	idx := strings.Index(yamlManifest, prefix)
	if idx < 0 {
		log.Warn().Msg("Could not find agent args in generated YAML")
		return yamlManifest
	}

	afterPrefix := yamlManifest[idx+len(prefix):]
	closeQuote := strings.Index(afterPrefix, `"`)
	if closeQuote < 0 {
		log.Warn().Msg("Malformed agent args in generated YAML")
		return yamlManifest
	}

	insertPoint := idx + len(prefix) + closeQuote + 1
	result := yamlManifest[:insertPoint] +
		fmt.Sprintf(`, "--server-address", "%s"`, serverAddress) +
		yamlManifest[insertPoint:]
	return result
}

func GetAgentsHandler(c *gin.Context) {
	userInfoInterface, exists := c.Get("userInfo")
	if !exists {
		log.Error().Msg("User info not found in context")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "User info not available"})
		return
	}

	userInfo, ok := userInfoInterface.(map[string]interface{})
	if !ok {
		log.Error().Msg("Invalid user info format")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid user info"})
		return
	}

	visibleAgentsRaw, exists := c.Get("visibleAgents")
	if !exists {
		log.Error().Msg("visibleAgents not found in context")
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	visibleAgents := visibleAgentsRaw.([]string)

	isSuperAdmin := false
	allowedAgents := map[string]bool{}

	if len(visibleAgents) == 1 && visibleAgents[0] == "*" {
		isSuperAdmin = true
	} else {
		for _, a := range visibleAgents {
			allowedAgents[a] = true
		}
	}

	agentsMutex.RLock()
	defer agentsMutex.RUnlock()

	returnAgents := make([]Agent, 0)

	for name, agent := range AgentConnections {
		if !isSuperAdmin && !allowedAgents[name] {
			continue
		}

		agent.agent.Name = name
		agent.agent.Metadata.Name = name
		agent.agent.Metadata.Namespace = "default"

		returnAgents = append(returnAgents, agent.agent)
	}

	log.Info().
		Str("user", fmt.Sprintf("%v", userInfo["username"])).
		Int("total_agents", len(AgentConnections)).
		Int("accessible_agents", len(returnAgents)).
		Bool("is_superadmin", isSuperAdmin).
		Msg("Filtered agents based on RBAC permissions")

	c.JSON(http.StatusOK, returnAgents)
}

func deleteAgent(agentName string) error {
	if agentName == "" {
		log.Error().Msg("deleteAgentHandler: agent_name is empty")
		return errors.New("missing agent_name parameter")
	}

	agentsMutex.Lock()
	defer agentsMutex.Unlock()

	agent, exists := AgentConnections[agentName]
	if !exists {
		log.Error().Msg("Agent not found")
		return fmt.Errorf("agent not found")
	}

	os.Remove(filepath.Join("certs", path.Clean(agent.agent.Name+".crt")))
	os.Remove(filepath.Join("certs", path.Clean(agent.agent.Name+".key")))

	delete(AgentConnections, agentName)

	log.Info().Str("agent", agentName).Msg("Agent deleted and certificate revoked")
	return nil
}

func DeleteAgentHandler(c *gin.Context) {
	userInfoInterface, exists := c.Get("userInfo")
	if !exists {
		log.Error().Msg("User info missing")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	userInfo := userInfoInterface.(map[string]interface{})
	isSuperAdmin := false

	switch r := userInfo["roles"].(type) {
	case map[string]bool:
		isSuperAdmin = r["superadmin"]
	case []string:
		for _, role := range r {
			if role == "superadmin" {
				isSuperAdmin = true
				break
			}
		}
	}

	if !isSuperAdmin {
		log.Warn().
			Str("user", fmt.Sprintf("%v", userInfo["username"])).
			Msg("Unauthorized attempt to delete agent")

		c.JSON(http.StatusForbidden, gin.H{
			"error": "Only superadmin can delete agents",
		})
		return
	}

	agentName := c.Param("agent")

	agentsMutex.Lock()
	defer agentsMutex.Unlock()

	if _, exists := AgentConnections[agentName]; !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		return
	}

	delete(AgentConnections, agentName)

	log.Warn().
		Str("user", fmt.Sprintf("%v", userInfo["username"])).
		Str("agent", agentName).
		Msg("Agent deleted")

	c.JSON(http.StatusOK, gin.H{
		"message": "Agent deleted",
		"agent":   agentName,
	})
}

// RegisterAgentRoutes registers all agent CRUD routes
func RegisterAgentRoutes(r *gin.Engine) {
	r.POST("/api/agents", CreateAgentHandler)
	r.POST("/api/agents/local", CreateLocalAgentHandler)
	r.DELETE("/api/agents/:agent", DeleteAgentHandler)
	r.GET("/api/agents", GetAgentsHandler)
}

func InitializeAgentsFromCerts() error {
	caCert, _, err := ca.LoadOrCreateCA()
	if err != nil {
		log.Error().Err(err).Msg("Error loading/creating CA")
		return err
	}
	files, err := os.ReadDir("certs")
	if err != nil {
		log.Fatal().Err(err).Msg("Error reading agent cert directory")
		return err
	}

	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".crt") {
			continue
		}
		certFile, err := os.ReadFile(filepath.Join("certs", file.Name()))
		if err != nil {
			log.Fatal().Err(err).Msg("Error reading agent cert file")
			return err
		}

		block, _ := pem.Decode(certFile)
		if block == nil {
			log.Fatal().Msg("Failed to parse agent certificate")
			return err
		}

		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			log.Fatal().Err(err).Msg("Failed to parse agent certificate")
			return err
		}

		if len(cert.Subject.CommonName) == 0 {
			log.Debug().Msg("Skipping agent cert file with no subjectAlternativeName")
			continue
		}

		if cert.Subject.CommonName == "csoc.gen3.org" {
			log.Debug().Msg("Skipping agent cert file with subjectAlternativeName csoc.gen3.org")
			continue
		}

		if cert.Subject.CommonName == caCert.Subject.CommonName {
			log.Debug().Msg("Skipping agent cert file with commonName equal to CA commonName")
			continue
		}

		agentName := strings.TrimSuffix(file.Name(), ".crt")
		agentCert := string(certFile)

		AgentConnections[agentName] = &AgentConnection{
			stream: nil,
			agent: Agent{
				Id:          cert.Subject.SerialNumber,
				Name:        agentName,
				Certificate: agentCert,
				Connected:   false,
			},
		}
	}
	return nil
}
