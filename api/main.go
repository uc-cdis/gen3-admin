// Setup MUX for API

package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/joho/godotenv"
	"github.com/uc-cdis/gen3-admin/internal/ca"
	"github.com/uc-cdis/gen3-admin/internal/helm"
	"github.com/uc-cdis/gen3-admin/internal/k8s"
	"github.com/uc-cdis/gen3-admin/internal/logger"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
	"github.com/uc-cdis/gen3-admin/internal/utils"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/rs/zerolog/pkgerrors"
	routes "github.com/uc-cdis/gen3-admin/pkg"
)

// types, constants and variables
type Agent struct {
	Id          string    `json:"id"`
	Name        string    `json:"name"`
	Certificate string    `json:"certificate"`
	Metadata    Metadata  `json:"metadata"`
	PrivateKey  string    `json:"private_key"`
	Connected   bool      `json:"connected"`
	LastSeen    time.Time `json:"lastSeen"`
	CpuUsage    float64   `json:"cpuUsage"`
	MemoryUsage float64   `json:"memoryUsage"`
	Provider    string    `json:"provider"`
	K8sVersion  string    `json:"k8sVersion"`
	PodCapacity int       `json:"podCapacity"`
	PodCount    int       `json:"podCount"`
}

type Metadata struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type agentServer struct {
	pb.UnimplementedTunnelServiceServer
	agentConnections      map[string]pb.TunnelService_ConnectServer
	proxyResponseChannels map[string](chan *pb.AgentMessage)
	mu                    sync.Mutex
}

type AgentConnection struct {
	stream          pb.TunnelService_ConnectServer
	requestChannels map[string]chan *pb.ProxyResponse
	cancelFuncs     map[string]context.CancelFunc
	contexts        map[string]context.Context
	mutex           sync.Mutex
	agent           Agent
}

var (
	// db          *sql.DB
	agentsMutex sync.RWMutex
	// agents      = make(map[string]Agent)
	certCurve = elliptic.P384()
	// agentConnections = make(map[string]pb.TunnelService_ConnectServer)
	agentConnections = make(map[string]*AgentConnection)
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		bearerToken := strings.Split(authHeader, " ")
		if len(bearerToken) != 2 || strings.ToLower(bearerToken[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
			c.Abort()
			return
		}

		// Extract claims for use in authz request
		tokenString := bearerToken[1]
		token, _ := jwt.Parse(tokenString, nil)
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			c.Abort()
			return
		}

		issuerURL, ok := claims["iss"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing issuer in token"})
			c.Abort()
			return
		}

		log.Info().Msgf("Issuer URL: %s", issuerURL)

		// Call AuthZ Service
		authzEndpoint := issuerURL + "/auth/mapping"
		reqBody, _ := json.Marshal(claims)
		authzResp, err := http.Post(authzEndpoint, "application/json", bytes.NewBuffer(reqBody))
		if err != nil {
			log.Error().Err(err).Msg("Error calling authZ service")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Authorization service error"})
			c.Abort()
			return
		}
		defer authzResp.Body.Close()

		log.Info().Msg("User is authorized")
		c.Next()
	}
}

func ForbiddenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		log.Warn().Msg("Not allowing due to authZ")
		c.AbortWithStatus(http.StatusForbidden) // Immediately abort and return 403
	}
}

// func initializeDatabase() (*sql.DB, error) {
// 	const databaseFile = "agents.db"

// 	db, err := sql.Open("sqlite3", databaseFile)
// 	if err != nil {
// 		return nil, fmt.Errorf("error opening database: %v", err)
// 	}

// 	_, err = db.Exec(`
//         CREATE TABLE IF NOT EXISTS agents (
//             id INTEGER PRIMARY KEY AUTOINCREMENT,
//             name TEXT UNIQUE NOT NULL,
//             certificate BLOB,
//             private_key BLOB,
//             connected INTEGER DEFAULT 0,
//             last_seen TEXT
//         );
//     `)
// 	if err != nil {
// 		db.Close()
// 		return nil, fmt.Errorf("error creating agents table: %v", err)
// 	}

// 	rows, err := db.Query("SELECT name, connected, certificate, private_key, last_seen FROM agents")
// 	if err != nil {
// 		log.Fatal().Err(err).Msg("Error querying agents from database")
// 		db.Close()
// 		return nil, err
// 	}
// 	defer rows.Close()

// 	for rows.Next() {
// 		var agent Agent
// 		var connected int
// 		var certificate, privateKey string
// 		var lastSeenStr sql.NullString
// 		err = rows.Scan(&agent.Name, &connected, &certificate, &privateKey, &lastSeenStr)
// 		if err != nil {
// 			log.Error().Err(err).Msg("Error scanning agents from database")
// 			continue
// 		}

// 		agent.Connected = connected != 0
// 		if lastSeenStr.Valid { // Check if the value is not NULL
// 			agent.LastSeen, err = time.Parse(time.RFC3339, lastSeenStr.String)
// 			if err != nil {
// 				log.Warn().Err(err).Str("last_seen", lastSeenStr.String).Msg("Error parsing last_seen time, using current time")
// 			}
// 		} else {
// 			agent.LastSeen = time.Time{} // Default to empty time if NULL
// 		}

// 		agent.Certificate = string(certificate)
// 		// log certificate
// 		log.Info().Msgf("agent %v", agent)
// 		// agent.PrivateKey = privateKey
// 		agentConnections[agent.Name] = agent
// 	}

// 	return db, nil
// }

func (s *agentServer) Connect(stream pb.TunnelService_ConnectServer) error {
	// Receive the initial registration message
	agentMsg, err := stream.Recv()
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "failed to receive registration message: %v", err)
	}

	// Extract the agent name from the registration message
	registrationRequest, ok := agentMsg.Message.(*pb.AgentMessage_Registration)
	if !ok {
		return status.Errorf(codes.InvalidArgument, "invalid registration message")
	}
	// TODO: Validate the agent name against the certificate
	agentName := registrationRequest.Registration.AgentName

	// TODO: Get the agent certificate from disk
	// Read agent cert file
	certFile, err := os.ReadFile(filepath.Join("certs", agentName+".crt"))
	if err != nil {
		log.Fatal().Err(err).Msg("Error reading agent cert file")
		return err
	}

	// Parse the certificate
	block, _ := pem.Decode(certFile)
	if block == nil {
		log.Fatal().Msg("Failed to parse agent certificate")
		return err
	}

	// TODO: Validate the certificate
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to parse agent certificate")
		return err
	}

	agent := &AgentConnection{
		stream:          stream,
		requestChannels: make(map[string]chan *pb.ProxyResponse),
		contexts:        make(map[string]context.Context),
		cancelFuncs:     make(map[string]context.CancelFunc),
		agent: Agent{
			Id:        cert.Subject.SerialNumber,
			Name:      agentName,
			Connected: true,
			LastSeen:  time.Now(),
			// TODO: Get the agent certificate from the registration message
			// Certificate: string(certificate),
		},
	}

	// Store the connection in the map
	agentsMutex.Lock()
	agentConnections[agentName] = agent
	agentsMutex.Unlock()

	log.Info().Msgf("Agent %s connected", agentName)

	// Handle incoming messages from the agent in a separate goroutine
	for {
		agentMessage, err := stream.Recv()
		if err != nil {
			if err == io.EOF || status.Code(err) == codes.Canceled {
				log.Info().Msgf("Agent %s disconnected", agentName)
			} else {
				log.Error().Err(err).Msgf("Error receiving message from agent %s", agentName)
			}

			agentsMutex.Lock()
			agentConnections[agentName] = &AgentConnection{
				stream: nil,
				agent: Agent{
					Connected: false,
				},
			}
			agentsMutex.Unlock()

			// Cancel all ongoing requests for this agent
			agent.mutex.Lock()
			for _, cancel := range agent.cancelFuncs {
				cancel()
			}
			agent.mutex.Unlock()

			return err
		}

		// Handle other message types (StatusUpdate, CommandResult, etc.)
		switch msg := agentMessage.Message.(type) {
		case *pb.AgentMessage_Registration:
			log.Debug().Msgf("Received registration from agent %s: %v", agentName, msg.Registration)
			agentsMutex.Lock()
			agentConnections[agentName] = agent
			agentsMutex.Unlock()

		case *pb.AgentMessage_Status:
			log.Debug().Msgf("Received status update from agent %s: %v", agentName, msg.Status)
			// Update the last seen time for the agent and the cpu and memory usage
			agentsMutex.Lock()
			agent := agentConnections[agentName]
			agent.agent.LastSeen = time.Now()
			agent.agent.CpuUsage = msg.Status.CpuUsage
			agent.agent.MemoryUsage = msg.Status.MemoryUsage
			agent.agent.Connected = true
			agent.agent.Provider = msg.Status.Provider
			agent.agent.K8sVersion = msg.Status.K8SVersion
			agentConnections[agentName] = agent
			agentsMutex.Unlock()
		case *pb.AgentMessage_Proxy:
			proxyResp := msg.Proxy
			agent.mutex.Lock()
			responseChan, exists := agent.requestChannels[proxyResp.StreamId]
			if exists {
				select {
				case responseChan <- proxyResp:
					log.Trace().Msgf("Response sent to channel for stream ID: %s", proxyResp.StreamId) // TODO: remove
				case <-time.After(3 * time.Second):
					log.Trace().Msgf("Timed out trying to send response for stream ID: %s", proxyResp.StreamId)
				case <-agent.contexts[proxyResp.StreamId].Done():
					log.Trace().Msgf("Request cancelled for stream ID: %s", proxyResp.StreamId)
					// Request was cancelled, clean up
					delete(agent.requestChannels, proxyResp.StreamId)
					delete(agent.cancelFuncs, proxyResp.StreamId)
				default:
					// Channel is full, log a warning but don't clean up
					log.Warn().Msgf("Channel is full for stream ID: %s", proxyResp.StreamId)
				}
			} else {
				log.Warn().Msgf("Received response for unknown stream ID: %s", proxyResp.StreamId)
			}
			agent.mutex.Unlock()

		default:
			log.Warn().Msgf("Unknown message type from agent %s: %T", agentName, msg)
		}
	}
}

func generateAgentConfig(agentName string) (string, error) {
	caCert, caKey, err := ca.LoadOrCreateCA()
	if err != nil {
		return "", fmt.Errorf("error loading/creating CA: %v", err)
	}

	agentPrivKey, err := ecdsa.GenerateKey(certCurve, rand.Reader)
	if err != nil {
		return "", fmt.Errorf("error generating agent key: %v", err)
	}

	id := uuid.New().String()

	serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)     // TODO: make this configurable
	serialNumber, err := rand.Int(rand.Reader, serialNumberLimit) // TODO: make this configurable
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

	// Write certificate and key to file
	utils.MustWriteFile("certs/"+agentName+".crt", []byte(agentCertPEM), 0644)
	utils.MustWriteFile("certs/"+agentName+".key", []byte(agentKeyPEM), 0600)

	log.Debug().Msgf("Certificate and key for agent %s dumped to file", agentName)

	// _, err = db.Exec("INSERT INTO agents (name, certificate, private_key, connected, last_seen) VALUES (?, ?, ?, 0, ?)",
	// 	agentName, agentCertPEM, agentKeyPEM, time.Now().Format(time.RFC3339))
	// if err != nil {
	// 	return "", fmt.Errorf("error registering agent in database: %v", err)
	// }

	agentConnections[agentName] = &AgentConnection{
		stream: nil,
		agent: Agent{
			Name:        agentName,
			Id:          id,
			Certificate: string(agentCertPEM),
			// PrivateKey:  string(agentKeyPEM),
			Connected: false,
		},
	}

	config := fmt.Sprintf(`
apiVersion: v1
kind: Secret
metadata:
  name: %s-tls
type: kubernetes.io/tls
data:
  tls.crt: %s
  tls.key: %s
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: %s
spec:
  replicas: 1
  selector:
    matchLabels:
      app: %s
  template:
    metadata:
      labels:
        app: %s
    spec:
      containers:
      - name: agent
        image: your-agent-image:latest
        args: ["-name", "%s"]
        volumeMounts:
        - name: tls-certs
          mountPath: /etc/agent/tls
          readOnly: true
      volumes:
      - name: tls-certs
        secret:
          secretName: %s-tls
`,
		agentName,
		base64.StdEncoding.EncodeToString(agentCertPEM),
		base64.StdEncoding.EncodeToString(agentKeyPEM),
		agentName, agentName, agentName, agentName, agentName,
	)

	return strings.TrimSpace(config), nil
}

func CreateAgentHandler(c *gin.Context) {
	log.Info().Msg("CreateAgentHandler")
	r := c.Request
	w := c.Writer
	var requestData struct {
		Name string `json:"name"`
	}
	err := json.NewDecoder(r.Body).Decode(&requestData)
	if err != nil {
		log.Error().Err(err).Msg("Error decoding request data")
		http.Error(w, "Invalid registration data", http.StatusBadRequest)
		return
	}

	config, err := generateAgentConfig(requestData.Name)
	if err != nil {
		log.Error().Err(err).Msg("Error generating agent config")
		http.Error(w, "Error generating agent config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(config))
}

func GetAgentsHandler(c *gin.Context) {
	w := c.Writer

	agentsMutex.RLock()
	defer agentsMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	// return an array of agents
	returnAgents := make([]Agent, 0)
	for name, agent := range agentConnections {
		log.Debug().Msgf("Agent %s", name)
		agent.agent.Name = name
		agent.agent.Metadata.Name = name
		agent.agent.Metadata.Namespace = "default"
		returnAgents = append(returnAgents, agent.agent)
	}
	json.NewEncoder(w).Encode(returnAgents)
}

func deleteAgent(agentName string) error {
	if agentName == "" {
		log.Error().Msg("deleteAgentHandler: agent_name is empty")
		return errors.New("missing agent_name parameter")
	}

	agentsMutex.Lock()
	defer agentsMutex.Unlock()

	agent, exists := agentConnections[agentName]
	if !exists {
		log.Error().Msg("Agent not found")
		return fmt.Errorf("agent not found")
	}

	// Delete the certs from disk
	os.Remove(filepath.Join("certs", agent.agent.Name+".crt"))
	os.Remove(filepath.Join("certs", agent.agent.Name+".key"))

	// TODO: CRL stuff
	// // Load CA certificate and key
	// caCert, caKey, err := ca.LoadOrCreateCA()
	// if err != nil {
	// 	log.Error().Err(err).Msg("Error loading/creating CA")
	// 	return err
	// }

	// // // Parse agent's certificate
	// agentCertBlock, _ := pem.Decode([]byte(agent.agent.Certificate))
	// if agentCertBlock == nil {
	// 	log.Error().Msg("Failed to parse agent certificate")
	// 	return errors.New("failed to parse agent certificate")
	// }

	// agentCert, err := x509.ParseCertificate([]byte(agentCertBlock.Bytes))
	// if err != nil {
	// 	log.Error().Err(err).Msg("error parsing agent certificate")
	// 	return err
	// }

	// // Create a Certificate Revocation List (CRL)
	// now := time.Now()
	// revokedCerts := []pkix.RevokedCertificate{
	// 	{
	// 		SerialNumber:   agentCert.SerialNumber,
	// 		RevocationTime: now,
	// 	},
	// }

	// crlBytes, err := caCert.CreateCRL(rand.Reader, caKey, revokedCerts, now, now.Add(24*time.Hour))
	// if err != nil {
	// 	log.Error().Err(err).Msg("Error creating CRL")
	// 	return err
	// }

	// // Save the CRL to a file
	// crlFilename := "revoked_certs.crl"
	// err = os.WriteFile(crlFilename, crlBytes, 0644)
	// if err != nil {
	// 	log.Error().Err(err).Msg("Error saving CRL")
	// 	return err
	// }

	// Remove the agent from the in-memory map
	delete(agentConnections, agentName)

	// // Remove the agent from the database
	// _, err = db.Exec("DELETE FROM agents WHERE name = ?", agentName)
	// if err != nil {
	// 	log.Error().Err(err).Msg("Error deleting agent from database")
	// 	return
	// }

	log.Info().Str("agent", agentName).Msg("Agent deleted and certificate revoked")
	return nil
}

func DeleteAgentHandler(c *gin.Context) {
	agentName := c.Param("agent")
	err := deleteAgent(agentName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Agent deleted"})
}

func HandleK8sProxyRequest(c *gin.Context) {
	agentID := c.Param("agent")
	path := c.Param("path")

	var wg sync.WaitGroup

	agentsMutex.RLock()
	agent, exists := agentConnections[agentID]
	agentsMutex.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		log.Warn().Msgf("Agent not found: %s", agentID)
		return
	}

	// var wsupgrader = websocket.Upgrader{
	// 	ReadBufferSize:  1024,
	// 	WriteBufferSize: 1024,
	// }

	// Generate a unique stream ID for this request
	streamID := uuid.New().String()

	// Create a channel for this request
	responseChan := make(chan *pb.ProxyResponse, 100)
	ctx, cancel := context.WithCancel(c.Request.Context())

	agent.mutex.Lock()
	agent.requestChannels[streamID] = responseChan
	agent.cancelFuncs[streamID] = cancel
	agent.contexts[streamID] = ctx
	agent.mutex.Unlock()

	defer func() {
		cancel()
		wg.Wait() // Wait for all response processing to complete
		agent.mutex.Lock()
		delete(agent.requestChannels, streamID)
		delete(agent.cancelFuncs, streamID)
		agent.mutex.Unlock()
		close(responseChan)
	}()

	// Create a ProxyRequest
	proxyReq := &pb.ProxyRequest{
		StreamId:  streamID,
		Method:    c.Request.Method,
		Path:      path,
		Headers:   make(map[string]string),
		Body:      nil,
		ProxyType: "k8s",
	}

	// Copy headers
	for k, v := range c.Request.Header {
		proxyReq.Headers[k] = strings.Join(v, ",")
	}

	// Read and set body if present
	if c.Request.Body != nil {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
			return
		}
		proxyReq.Body = body
	}
	// log.Debug().Msgf("Proxy request: %v", proxyReq)

	// Send the request through the gRPC stream
	err := agent.stream.Send(&pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: proxyReq,
		},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send request to agent"})
		return
	}

	// Handle the response stream
	var responseStarted bool
	for {
		select {
		case resp, ok := <-responseChan:
			if !ok {
				if !responseStarted {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
				}
				log.Debug().Msgf("Response channel closed for stream ID: %s", streamID)
				return
			}
			switch resp.Status {
			case pb.ProxyResponseType_HEADERS:
				if !responseStarted {
					responseStarted = true
					// Set response headers
					for k, v := range resp.Headers {
						c.Header(k, v)
					}
					// log.Debug().Msgf("Headers sent to HTTP client: %v", resp.Headers)
					c.Status(int(resp.StatusCode))
				}
			case pb.ProxyResponseType_DATA:
				log.Debug().Msgf("Got data chunk from agent")
				if !responseStarted {
					responseStarted = true
				}
				// Write response body chunk
				_, err := c.Writer.Write(resp.Body)
				if err != nil {
					log.Error().Err(err).Msg("Failed to write response body chunk")
					return
				}
			case pb.ProxyResponseType_END:
				log.Trace().Msg("Proxy response end message")
				c.Writer.Flush() // Ensure all data is sent
				c.Abort()
				return
			case pb.ProxyResponseType_ERROR:
				log.Trace().Msg("Proxy response error message")
				if !responseStarted {
					responseStarted = true
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": string(resp.Body)})
				return
			default:
				log.Warn().Msgf("Unknown message type from stream %s: %T", streamID, resp)
			}

		case <-ctx.Done():
			return
		}
	}
}

func setupGRCPServer() {
	creds, err := ca.SetupCerts()
	if err != nil {
		log.Fatal().Err(err).Msg("Error setting up certificates")
	}

	// Create and start gRPC server with TLS credentials
	s := grpc.NewServer(grpc.Creds(*creds))

	pb.RegisterTunnelServiceServer(s, &agentServer{})

	lis, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", 50051))
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to listen on port")
	}
	go s.Serve(lis)

	log.Info().Msg("GRPC Server listening on :50051")
}

func setupHTTPServer() {
	//  HTTP Server
	// Initialize Gin
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()                          // empty engine
	r.Use(logger.DefaultStructuredLogger()) // adds our new middleware
	r.Use(gin.Recovery())                   // adds the default recovery middleware

	// Get environment variables
	// jwksURL := os.Getenv("OKTA_JWKS_URL")
	// issuer := os.Getenv("OKTA_ISSUER")
	// clientID := os.Getenv("OKTA_CLIENT_ID")

	// r.Use(auth.AuthMiddleware(jwksURL, issuer, clientID))

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	routes.Routes(r)

	proxy, err := k8s.SetupReverseProxy()
	if err != nil {
		panic(err) // Handle error appropriately for your situation
	}

	r.Any("/api/k8s/proxy/*path", func(c *gin.Context) {
		requestPath := strings.TrimPrefix(c.Request.URL.Path, "/api/k8s/proxy")
		c.Request.URL.Path = requestPath

		// Log the outgoing request URL
		log.Info().Msgf("Proxying request to: %s", c.Request.URL.String())

		proxy.ServeHTTP(c.Writer, c.Request)
	})

	r.Any("api/k8s/:agent/proxy/*path", func(c *gin.Context) {

		log.Info().Msgf("Proxying agent k8s request to: %s", c.Request.URL.String())
		HandleK8sProxyRequest(c)
	})

	r.POST("/api/agents", CreateAgentHandler)
	r.GET("/api/agents", GetAgentsHandler)
	r.DELETE("/api/agents/:agent", DeleteAgentHandler)

	r.GET("/api/agents/:agent/helm/list", func(c *gin.Context) {
		agentID := c.Param("agent")
		agentsMutex.RLock()
		agent, exists := agentConnections[agentID]
		agentsMutex.RUnlock()
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
			return
		}

		// Create a response channel for the agent
		responseChan := make(chan *pb.ProxyResponse, 100)
		ctx, cancel := context.WithCancel(c.Request.Context())

		streamID := uuid.New().String()

		agent.mutex.Lock()
		agent.requestChannels[streamID] = responseChan
		agent.cancelFuncs[streamID] = cancel
		agent.contexts[streamID] = ctx
		agent.mutex.Unlock()

		agent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_Projects{
				Projects: &pb.ProjectsRequest{
					StreamId: streamID,
				},
			},
		})

		// Handle the response stream

		select {
		case resp := <-responseChan:
			agent.mutex.Lock()
			delete(agent.requestChannels, uuid.New().String())
			delete(agent.cancelFuncs, uuid.New().String())
			delete(agent.contexts, uuid.New().String())
			agent.mutex.Unlock()

			if resp.Status != pb.ProxyResponseType_DATA {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
				return
			}
			c.Data(http.StatusOK, "application/json", resp.Body)
		case <-ctx.Done():
			agent.mutex.Lock()
			delete(agent.requestChannels, uuid.New().String())
			delete(agent.cancelFuncs, uuid.New().String())
			delete(agent.contexts, uuid.New().String())
			agent.mutex.Unlock()

			c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
			return
		}
	})

	r.GET("/api/agent/:agent/helm/values/:releasename/:namespace", func(c *gin.Context) {
		agentID := c.Param("agent")
		releaseName := c.Param("releasename")
		namespace := c.Param("namespace")
		agentsMutex.RLock()
		agent, exists := agentConnections[agentID]
		agentsMutex.RUnlock()
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
			return
		}

		// Create a response channel for the agent
		responseChan := make(chan *pb.ProxyResponse, 100)
		ctx, cancel := context.WithCancel(c.Request.Context())

		streamID := uuid.New().String()

		agent.mutex.Lock()
		agent.requestChannels[streamID] = responseChan
		agent.cancelFuncs[streamID] = cancel
		agent.contexts[streamID] = ctx
		agent.mutex.Unlock()

		agent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_HelmValuesRequest{
				HelmValuesRequest: &pb.HelmValuesRequest{
					StreamId:  streamID,
					Release:   releaseName,
					Namespace: namespace,
				},
			},
		})

		// Handle the response stream
		select {
		case resp := <-responseChan:
			agent.mutex.Lock()
			delete(agent.requestChannels, uuid.New().String())
			delete(agent.cancelFuncs, uuid.New().String())
			delete(agent.contexts, uuid.New().String())
			agent.mutex.Unlock()

			if resp.Status != pb.ProxyResponseType_DATA {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
				return
			}
			c.Data(http.StatusOK, "application/json", resp.Body)
		case <-ctx.Done():
			agent.mutex.Lock()
			delete(agent.requestChannels, uuid.New().String())
			delete(agent.cancelFuncs, uuid.New().String())
			delete(agent.contexts, uuid.New().String())
			agent.mutex.Unlock()

			c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
			return
		}
	})

	r.DELETE("/api/agent/:agent/helm/delete/:release/:namespace", func(c *gin.Context) {
		agentID := c.Param("agent")
		releaseName := c.Param("release")
		namespace := c.Param("namespace")
		agentsMutex.RLock()
		agent, exists := agentConnections[agentID]
		agentsMutex.RUnlock()
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
			return
		}

		log.Warn().Msgf("Creating response channel for helm delete request: %v", releaseName)

		// Create a response channel for the agent
		responseChan := make(chan *pb.ProxyResponse, 100)
		ctx, cancel := context.WithCancel(c.Request.Context())

		streamID := uuid.New().String()

		agent.mutex.Lock()
		agent.requestChannels[streamID] = responseChan
		agent.cancelFuncs[streamID] = cancel
		agent.contexts[streamID] = ctx
		agent.mutex.Unlock()

		agent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_HelmDeleteRequest{
				HelmDeleteRequest: &pb.HelmDeleteRequest{
					StreamId:  streamID,
					Release:   releaseName,
					Namespace: namespace,
				},
			},
		})

		log.Info().Msgf("Helm delete request sent: %v", releaseName)

		// Handle the response stream
		select {
		case resp := <-responseChan:
			agent.mutex.Lock()
			delete(agent.requestChannels, uuid.New().String())
			delete(agent.cancelFuncs, uuid.New().String())
			delete(agent.contexts, uuid.New().String())
			agent.mutex.Unlock()

			if resp.Status != pb.ProxyResponseType_DATA {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid response from agent"})
				return
			}
			c.Data(http.StatusOK, "application/json", resp.Body)
		case <-ctx.Done():
			agent.mutex.Lock()
			delete(agent.requestChannels, uuid.New().String())
			delete(agent.cancelFuncs, uuid.New().String())
			delete(agent.contexts, uuid.New().String())
			agent.mutex.Unlock()

			c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
			return
		}
	})

	// r.POST("/api/helm/:agent/install/", func(c *gin.Context) {
	// 	agentID := c.Param("agent")
	// 	repoName := c.Request.Body.Get("repo")
	// 	chartName := c.Request.Body.Get("chart")
	// 	version := c.Request.Body.Get("version")
	// 	log.Info().Msgf("Installing chart %s from repo %s version %s", chartName, repoName, version)

	// 	// Check if the agent is connected
	// 	agentsMutex.RLock()
	// 	agent, exists := agentConnections[agentID]
	// 	agentsMutex.RUnlock()
	// 	if !exists {
	// 		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
	// 		return
	// 	}

	// })

	r.POST("/api/helm/install", func(c *gin.Context) {
		// Ready from json request body
		var requestData struct {
			Repo      string `json:"repo"`
			Chart     string `json:"chart"`
			Version   string `json:"version"`
			Namespace string `json:"namespace"`
		}
		err := json.NewDecoder(c.Request.Body).Decode(&requestData)
		if err != nil {
			log.Error().Err(err).Msg("Error decoding request data")
			http.Error(c.Writer, "Invalid request data", http.StatusBadRequest)
			return
		}

		repoName := requestData.Repo
		chartName := requestData.Chart
		version := requestData.Version
		namespace := requestData.Namespace
		log.Info().Msgf("Installing chart %s from repo %s version %s into namespace %s", chartName, repoName, version, namespace)
		release, err := helm.InstallHelmChart(chartName, namespace, repoName, chartName, version)
		if err != nil {
			log.Error().Err(err).Msg("Error installing chart")
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, release)
	})

	r.GET("/api/helm/values/:release", func(c *gin.Context) {
		releaseName := c.Param("release")
		values, err := helm.ShowHelmValues(releaseName, "default")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, values)
	})

	r.GET("/api/helm/repos", func(c *gin.Context) {
		repos, err := helm.ListHelmRepos()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, repos)
	})

	r.GET("/api/helm/charts/:repo", func(c *gin.Context) {
		repo := c.Param("repo")
		charts, err := helm.ListHelmCharts(repo)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, charts)
	})

	r.Static("/static", "./static")
	r.Routes()

	log.Info().Msg("Starting API server")

	// run on port 8002
	err = r.Run(":8002")
	if err != nil {
		log.Fatal().Err(err).Msg("Error starting HTTP server")
	}

	// // Start Next.js app
	// go startNextApp()

}

func initializeAgentsFromCerts() error {

	// Load CA certificate and key
	caCert, _, err := ca.LoadOrCreateCA()
	if err != nil {
		log.Error().Err(err).Msg("Error loading/creating CA")
		return err
	}
	// List all agents cert files
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

		// Parse the certificate
		block, _ := pem.Decode(certFile)
		if block == nil {
			log.Fatal().Msg("Failed to parse agent certificate")
			return err
		}

		// TODO: Validate the certificate
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			log.Fatal().Err(err).Msg("Failed to parse agent certificate")
			return err
		}

		// Check the subjectAlternativeName
		if len(cert.Subject.CommonName) == 0 {
			// Probably not a agent cert file
			log.Debug().Msg("Skipping agent cert file with no subjectAlternativeName")
			continue
		}

		// Check if the subjectAlternativeName has server in it (TODO: make this configurable)
		if cert.Subject.CommonName == "csoc.gen3.org" {
			log.Debug().Msg("Skipping agent cert file with subjectAlternativeName csoc.gen3.org")
			continue
		}

		// Check if the commonName is the CA commonName
		if cert.Subject.CommonName == caCert.Subject.CommonName {
			log.Debug().Msg("Skipping agent cert file with commonName equal to CA commonName")
			continue
		}

		agentName := strings.TrimSuffix(file.Name(), ".crt")
		agentCert := string(certFile)

		// Update the agents map with a disconnected agent
		agentConnections[agentName] = &AgentConnection{
			stream: nil,
			agent: Agent{
				Id:          cert.Subject.SerialNumber,
				Name:        agentName,
				Connected:   false,
				Certificate: agentCert,
			},
		}
	}
	return nil
}

func main() {
	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	zerolog.ErrorStackMarshaler = pkgerrors.MarshalStack
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	log.Logger = log.With().Caller().Logger()

	// Load the .env file
	err := godotenv.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("Error loading .env file")
	}

	// initialize agents from certs
	initializeAgentsFromCerts()
	// db, err := initializeDatabase()
	// if err != nil {
	// 	log.Fatal().Err(err).Msg("Error initializing database")
	// 	return
	// }
	// defer db.Close()
	// ctx, cancel := context.WithCancel(context.Background())
	// defer cancel()

	setupGRCPServer()
	setupHTTPServer()

}
