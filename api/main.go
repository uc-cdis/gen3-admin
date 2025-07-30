// Setup MUX for API

package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
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
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"text/template"
	"bytes"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"
	"github.com/uc-cdis/gen3-admin/internal/runner"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	"github.com/joho/godotenv"
	"github.com/uc-cdis/gen3-admin/internal/ca"
	"github.com/uc-cdis/gen3-admin/internal/helm"
	"github.com/uc-cdis/gen3-admin/internal/k8s"

	"github.com/uc-cdis/gen3-admin/internal/aws"

	"github.com/uc-cdis/gen3-admin/internal/logger"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
	"github.com/uc-cdis/gen3-admin/internal/utils"

	"net/http"
	_ "net/http/pprof"

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
	terminalStreams map[string]*websocket.Conn
}

type ServiceAccountData struct {
  	EKS				bool
  	RoleARN			string
}

type JWK struct {
	Kty string   `json:"kty"`
	Kid string   `json:"kid"`
	Use string   `json:"use"`
	N   string   `json:"n"`
	E   string   `json:"e"`
	X5c []string `json:"x5c"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

var (
	jwksCache    *JWKS
	jwksCacheExp time.Time
)

var (
	// db          *sql.DB
	agentsMutex sync.RWMutex
	// agents      = make(map[string]Agent)
	certCurve = elliptic.P384()
	// agentConnections = make(map[string]pb.TunnelService_ConnectServer)
	agentConnections = make(map[string]*AgentConnection)
	validAgentName   = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

func fetchJWKS() (*JWKS, error) {
	keycloakURL := os.Getenv("KEYCLOAK_URL")
	realm := os.Getenv("KEYCLOAK_REALM")

	if keycloakURL == "" || realm == "" {
		return nil, fmt.Errorf("KEYCLOAK_URL and KEYCLOAK_REALM must be set")
	}

	jwksURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/certs", keycloakURL, realm)
	log.Debug().Str("jwks_url", jwksURL).Msg("Attempting to fetch JWKS")

	resp, err := http.Get(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()
	var jwks JWKS
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode JWKS: %w", err)
	}

	log.Debug().Int("key_count", len(jwks.Keys)).Msg("Successfully fetched JWKS")
	return &jwks, nil
}

func getJWKS() (*JWKS, error) {
	if jwksCache != nil && time.Now().Before(jwksCacheExp) {
		return jwksCache, nil
	}

	jwks, err := fetchJWKS()
	if err != nil {
		return nil, err
	}

	jwksCache = jwks
	jwksCacheExp = time.Now().Add(time.Hour)

	return jwks, nil
}

func getPublicKey(kid string) (*rsa.PublicKey, error) {
	jwks, err := getJWKS()
	if err != nil {
		return nil, err
	}

	for _, key := range jwks.Keys {
		if key.Kid == kid && key.Kty == "RSA" {
			return jwt.ParseRSAPublicKeyFromPEM([]byte(fmt.Sprintf(
				"-----BEGIN CERTIFICATE-----\n%s\n-----END CERTIFICATE-----",
				key.X5c[0],
			)))
		}
	}

	return nil, fmt.Errorf("key with kid %s not found", kid)
}

func keyFunc(token *jwt.Token) (interface{}, error) {
	// Verify the signing method
	if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
	}

	// Get the kid from token header
	kid, ok := token.Header["kid"].(string)
	if !ok {
		return nil, fmt.Errorf("kid not found in token header")
	}

	// Get the public key
	return getPublicKey(kid)
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		url := c.Request.URL.Path
		method := c.Request.Method

		var tokenString string

		// First try to get token from Authorization header
		if authHeader != "" {
			bearerToken := strings.Split(authHeader, " ")
			if len(bearerToken) != 2 || strings.ToLower(bearerToken[0]) != "bearer" {
				log.Error().Msg("error: Invalid Authorization header format")
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
				c.Abort()
				return
			}
			tokenString = bearerToken[1]
		} else {
			// Try to get token from cookie if no Authorization header
			cookie, err := c.Cookie("access-token")
			if err != nil {
				log.Error().Msg("error: Authorization header or access-token cookie is required")
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or access-token cookie is required"})
				c.Abort()
				return
			}
			tokenString = cookie
		}

		token, err := jwt.Parse(tokenString, keyFunc)
		if err != nil {
			log.Error().Err(err).Msg("error: Token verification failed")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token verification failed"})
			c.Abort()
			return
		}

		if !token.Valid {
			log.Error().Msg("error: Invalid token")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			log.Error().Msg("error: Invalid claims")
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			c.Abort()
			return
		}

		expectedIssuer := fmt.Sprintf("%s/realms/%s", os.Getenv("KEYCLOAK_URL"), os.Getenv("KEYCLOAK_REALM"))
		if iss, ok := claims["iss"].(string); ok {
			if iss != expectedIssuer {
				legacyIssuer := fmt.Sprintf("%s/auth/realms/%s", os.Getenv("KEYCLOAK_URL"), os.Getenv("KEYCLOAK_REALM"))
				if iss != legacyIssuer {
					log.Error().Str("expected", expectedIssuer).Str("legacy_expected", legacyIssuer).Str("actual", iss).Msg("error: Invalid issuer")
					c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token issuer"})
					c.Abort()
					return
				}
			}
		}

		// Verify audience (client_id)
		// expectedAudience := os.Getenv("KEYCLOAK_CLIENT_ID")
		// if aud, ok := claims["aud"]; ok {
		// 	var validAudience bool
		// 	switch v := aud.(type) {
		// 	case string:
		// 		validAudience = v == expectedAudience
		// 	case []interface{}:
		// 		for _, audience := range v {
		// 			if audStr, ok := audience.(string); ok && audStr == expectedAudience {
		// 				validAudience = true
		// 				break
		// 			}
		// 		}
		// 	}
		// 	if !validAudience {
		// 		log.Error().Str("expected", expectedAudience).Interface("actual", aud).Msg("error: Invalid audience")
		// 		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token audience"})
		// 		c.Abort()
		// 		return
		// 	}
		// }

		if exp, ok := claims["exp"].(float64); ok {
			if time.Now().Unix() > int64(exp) {
				log.Error().Msg("error: Token has expired")
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token has expired"})
				c.Abort()
				return
			}
		}

		userInfo := make(map[string]interface{})

		if sub, ok := claims["sub"]; ok {
			userInfo["id"] = sub
		}
		if name, ok := claims["name"]; ok {
			userInfo["name"] = name
		}
		if email, ok := claims["email"]; ok {
			userInfo["email"] = email
		}
		if username, ok := claims["preferred_username"]; ok {
			userInfo["username"] = username
		}
		if givenName, ok := claims["given_name"]; ok {
			userInfo["given_name"] = givenName
		}
		if familyName, ok := claims["family_name"]; ok {
			userInfo["family_name"] = familyName
		}
		if emailVerified, ok := claims["email_verified"]; ok {
			userInfo["email_verified"] = emailVerified
		}

		if groups, ok := claims["groups"].([]interface{}); ok {
			userInfo["groups"] = groups
		}

		if userRoles, ok := claims["roles"].([]interface{}); ok {
			userInfo["user_roles"] = userRoles
		}

		if resourceAccess, ok := claims["resource_access"].(map[string]interface{}); ok {
			if account, ok := resourceAccess["account"].(map[string]interface{}); ok {
				if roles, ok := account["roles"].([]interface{}); ok {
					var accRoleStrings []string
					for _, role := range roles {
						if roleStr, ok := role.(string); ok {
							accRoleStrings = append(accRoleStrings, roleStr)
						}
					}
					userInfo["account_roles"] = accRoleStrings
				}
			}
		}

		if iss, ok := claims["iss"].(string); ok {
			userInfo["issuer"] = iss
		}
		if aud, ok := claims["aud"]; ok {
			userInfo["audience"] = aud
		}
		if exp, ok := claims["exp"].(float64); ok {
			userInfo["expires_at"] = time.Unix(int64(exp), 0)
		}
		if iat, ok := claims["iat"].(float64); ok {
			userInfo["issued_at"] = time.Unix(int64(iat), 0)
		}

		c.Set("userInfo", userInfo)

		groupsIface, ok := userInfo["groups"].([]interface{})
		if !ok {
			log.Error().Msg("error: User groups missing or invalid")
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: missing groups"})
			c.Abort()
			return
		}

		var groups []string
		for _, g := range groupsIface {
			if groupStr, ok := g.(string); ok {
				cleanGroup := strings.TrimPrefix(groupStr, "/")
				groups = append(groups, cleanGroup)

			}
		}

		log.Info().Msgf("Groups: %s", groups)

		parts := strings.Split(strings.TrimPrefix(url, "/api/k8s/"), "/")
		if len(parts) < 1 {
			log.Error().Msg("error: Could not extract agent from URL")
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: invalid URL"})
			c.Abort()
			return
		}
		agent := parts[0]

		readGroup := fmt.Sprintf("%s-read", agent)
		writeGroup := fmt.Sprintf("%s-write", agent)

		hasGroup := func(target string) bool {
			for _, g := range groups {
				if g == target {
					return true
				}
			}
			return false
		}

		if method == http.MethodGet {
			if !hasGroup(readGroup) && !hasGroup(writeGroup) && !hasGroup("superadmin") {
				c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: read permission required"})
				log.Error().Msg("error: Access denied: read permission required")
				c.Abort()
				return
			}
		} else if method == http.MethodPost || method == http.MethodPatch || method == http.MethodPut || method == http.MethodDelete {
			if !hasGroup(writeGroup) && !hasGroup("superadmin") {
				c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: write or superadmin permission required"})
				log.Error().Msg("error: Access denied: write or superadmin permission required")
				c.Abort()
				return
			}
		}

		log.Info().
			Str("user", fmt.Sprintf("%v", userInfo["username"])).
			Str("email", fmt.Sprintf("%v", userInfo["email"])).
			Str("id", fmt.Sprintf("%v", userInfo["id"])).
			Str("grps", fmt.Sprintf("%v", userInfo["groups"])).
			Str("user_roles", fmt.Sprintf("%v", userInfo["user_roles"])).
			Str("acc_roles", fmt.Sprintf("%v", userInfo["account_roles"])).
			Msg("User authenticated and authorized")

		c.Next()
	}
}

func SuccessMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
	}
}

func ForbiddenMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		log.Warn().Msg("Not allowing due to authZ")
		c.AbortWithStatus(http.StatusForbidden) // Immediately abort and return 403
	}
}

func (s *agentServer) Connect(stream pb.TunnelService_ConnectServer) error {
	// Extract TLS Info for client authentication
	p, ok := peer.FromContext(stream.Context())
	if !ok {
		return status.Errorf(codes.Unauthenticated, "failed to retrieve TLS info")
	}

	tlsInfo := p.AuthInfo.(credentials.TLSInfo)
	if len(tlsInfo.State.PeerCertificates) == 0 {
		return status.Errorf(codes.Unauthenticated, "no client certificates found")
	}

	tlsAuth, ok := p.AuthInfo.(credentials.TLSInfo)
	if !ok {
		return status.Error(codes.Unauthenticated, "unexpected peer transport credentials")
	}

	if len(tlsAuth.State.VerifiedChains) == 0 || len(tlsAuth.State.VerifiedChains[0]) == 0 {
		return status.Error(codes.Unauthenticated, "could not verify peer certificate")
	}
	clientCert := tlsInfo.State.PeerCertificates[0]
	agentNameCert := clientCert.Subject.CommonName

	agentMsg, err := stream.Recv()
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "failed to receive registration message: %v", err)
	}

	registrationRequest, ok := agentMsg.Message.(*pb.AgentMessage_Registration)
	if !ok {
		return status.Errorf(codes.InvalidArgument, "invalid registration message")
	}

	agentName := registrationRequest.Registration.AgentName

	// Check subject common name against configured username
	if tlsAuth.State.VerifiedChains[0][0].Subject.CommonName != agentName {
		return status.Error(codes.Unauthenticated, "invalid subject common name")
	}
	// Validate the agent name against the certificate
	if agentName != agentNameCert {
		return status.Errorf(codes.PermissionDenied, "agent name mismatch")
	}

	// Allow only alphanumeric, underscore, and hyphen
	if !validAgentName.MatchString(agentName) {
		return status.Error(codes.InvalidArgument, "invalid agent name")
	}

	// Read agent cert file
	certFile, err := os.ReadFile(filepath.Join("certs", path.Clean(agentName+".crt")))
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

	// Check if the agent is already connected
	agentsMutex.Lock()
	existingAgent, exists := agentConnections[agentName]
	if exists && existingAgent.stream != nil {
		// If there's an existing connection, disconnect the old one
		log.Warn().Msgf("Agent %s is already connected. Replacing the connection.", agentName)
		// Send a disconnect message to the old connection
		// We unlock the mutex lock to let the agent properly disconnect.
		agentsMutex.Unlock()

		existingAgent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_Registration{
				Registration: &pb.RegistrationResponse{
					Message: "Agent is already connected. Replacing the connection.",
					Success: false,
				},
			},
		})

		// Sleep here to avoid a race condition to let the previous agent disconnect properly from the message above.
		time.Sleep(1 * time.Second)
		agentsMutex.Lock()

		// Remove from the map immediately to prevent new requests
		delete(agentConnections, agentName)

		// Cancel any pending requests or goroutines tied to the old connection
		for _, cancel := range existingAgent.cancelFuncs {
			cancel()
		}
	}

	agent := &AgentConnection{
		stream:          stream,
		requestChannels: make(map[string]chan *pb.ProxyResponse),
		contexts:        make(map[string]context.Context),
		cancelFuncs:     make(map[string]context.CancelFunc),
		terminalStreams: make(map[string]*websocket.Conn),
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

			log.Warn().Msg("Deleting the agent connection from map.")
			agentsMutex.Lock()
			agentConnections[agentName] = &AgentConnection{
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
		case *pb.AgentMessage_TerminalStream:
			termResp := msg.TerminalStream
			log.Debug().Msgf("Received terminal stream from agent %s: %v", agentName, termResp.Data)
			agent.mutex.Lock()
			webSocket, exists := agent.terminalStreams[termResp.SessionId]
			agent.mutex.Unlock()

			if exists {
				err := webSocket.WriteMessage(websocket.TextMessage, termResp.Data)
				if err != nil {
					log.Warn().Err(err).Msgf("Failed to write TerminalStream to WebSocket for session ID: %s", termResp.SessionId)

					// optional: cleanup if writing failed
					agent.mutex.Lock()
					if cancel, ok := agent.cancelFuncs[termResp.SessionId]; ok {
						cancel()
						delete(agent.terminalStreams, termResp.SessionId)
						delete(agent.cancelFuncs, termResp.SessionId)
						delete(agent.contexts, termResp.SessionId)
					}
					agent.mutex.Unlock()
				} else {
					log.Trace().Msgf("TerminalStream sent to WebSocket for session ID: %s", termResp.SessionId)
				}
			} else {
				log.Warn().Msgf("No WebSocket found for session ID: %s", termResp.SessionId)
			}

		default:
			log.Warn().Msgf("Unknown message type from agent %s: %T", agentName, msg)
		}
	}
}

const saTemplate = `---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: csoc
  namespace: csoc
{{- if .EKS }}
  annotations:
    eks.amazonaws.com/role-arn: {{ .RoleARN }}
{{- end }}
`

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
	caCertPem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCert.Raw})

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
  name: csoc-tls
type: opaque
data:
  %s.crt: %s
  %s.key: %s
  ca.crt: %s
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
        volumeMounts:
        - name: tls-certs
          mountPath: /app/gen3-agent/certs/
          readOnly: true
      volumes:
      - name: tls-certs
        secret:
          secretName: csoc-tls
`,
		agentName,
		base64.StdEncoding.EncodeToString(agentCertPEM),
		agentName,
		base64.StdEncoding.EncodeToString(agentKeyPEM),
		base64.StdEncoding.EncodeToString(caCertPem),
		agentName,
	)

	const saTemplate = `---
apiVersion: v1
kind: ServiceAccount
metadata:
name: csoc
namespace: csoc
{{- if .EKS }}
annotations:
	eks.amazonaws.com/role-arn: {{ .RoleARN }}
{{- end -}}
	`

	saData := ServiceAccountData{
		EKS: true,
		RoleARN: "roleARN",
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
	os.Remove(filepath.Join("certs", path.Clean(agent.agent.Name+".crt")))
	os.Remove(filepath.Join("certs", path.Clean(agent.agent.Name+".key")))

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
	queryString := c.Request.URL.Query().Encode()

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
	responseChan := make(chan *pb.ProxyResponse, 10000)
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
		Path:      path + "?" + queryString,
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

func HandleHTTPProxyRequest(c *gin.Context) {
	agentID := c.Param("agent")
	path := c.Param("path")

	log.Info().Msgf("Path: %s", path)

	// Ensure path starts with /
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	// Add query string if present
	if c.Request.URL.RawQuery != "" {
		path += "?" + c.Request.URL.RawQuery
	}

	var wg sync.WaitGroup

	agentsMutex.RLock()
	agent, exists := agentConnections[agentID]
	agentsMutex.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		log.Warn().Msgf("Agent not found: %s", agentID)
		return
	}

	// Generate a unique stream ID for this request
	streamID := uuid.New().String()

	// Create a channel for this request
	responseChan := make(chan *pb.ProxyResponse, 10000)
	ctx, cancel := context.WithCancel(c.Request.Context())

	agent.mutex.Lock()
	agent.requestChannels[streamID] = responseChan
	agent.cancelFuncs[streamID] = cancel
	agent.contexts[streamID] = ctx
	agent.mutex.Unlock()

	defer func() {
		cancel()
		wg.Wait()
		agent.mutex.Lock()
		delete(agent.requestChannels, streamID)
		delete(agent.cancelFuncs, streamID)
		agent.mutex.Unlock()
		close(responseChan)
	}()

	// Create a ProxyRequest for HTTP
	proxyReq := &pb.ProxyRequest{
		StreamId:  streamID,
		Method:    c.Request.Method,
		Path:      path,
		Headers:   make(map[string]string),
		Body:      nil,
		ProxyType: "http",
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

	// Handle the response stream (same as K8s version)
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
				c.Writer.Flush()
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
	s := grpc.NewServer(
		grpc.Creds(*creds),
	)

	pb.RegisterTunnelServiceServer(s, &agentServer{})

	lis, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", 50051))
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
	r.Use(gin.Recovery())

	r.RedirectTrailingSlash = false
	// Add to your main function
	go func() {
		fmt.Println(http.ListenAndServe("localhost:6060", nil))
	}()

	// Get environment variables
	// jwksURL := os.Getenv("OKTA_JWKS_URL")
	// issuer := os.Getenv("OKTA_ISSUER")
	// clientID := os.Getenv("OKTA_CLIENT_ID")

	// r.Use(AuthMiddleware())

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	routes.Routes(r)

	// Set up reverse proxy for k8s API
	proxy, err := k8s.SetupReverseProxy()
	if err != nil {
		panic(err) // Handle error appropriately for your situation
	}

	protected := r.Group("/")
	// protected.Use(AuthMiddleware())
	protected.Use(SuccessMiddleware())
	{
		protected.Any("/api/k8s/proxy/*path", func(c *gin.Context) {
			requestPath := strings.TrimPrefix(c.Request.URL.Path, "/api/k8s/proxy")
			c.Request.URL.Path = requestPath
			log.Info().Msgf("Proxying request to: %s", c.Request.URL.String())
			proxy.ServeHTTP(c.Writer, c.Request)
		})

		protected.Any("/api/k8s/:agent/proxy/*path", func(c *gin.Context) {
			log.Info().Msgf("Proxying agent k8s request to: %s", c.Request.URL.String())
			HandleK8sProxyRequest(c)
		})

		protected.Any("/api/:agent/proxy/*path", func(c *gin.Context) {
			log.Info().Msgf("Proxying agent k8s request to: %s", c.Request.URL.String())
			HandleHTTPProxyRequest(c)
		})
	}

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
		responseChan := make(chan *pb.ProxyResponse, 10000)
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
		responseChan := make(chan *pb.ProxyResponse, 10000)
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
		responseChan := make(chan *pb.ProxyResponse, 10000)
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

	r.POST("/api/agent/:agent/helm/install", func(c *gin.Context) {
		agentID := c.Param("agent")
		if agentID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Agent name is required"})
			return
		}
		agentsMutex.RLock()
		agent, exists := agentConnections[agentID]
		agentsMutex.RUnlock()
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
			return
		}

		// Ready from json request body
		var requestData struct {
			Repo      string                 `json:"repo"`
			RepoUrl   string                 `json:"repoUrl"`
			Chart     string                 `json:"chart"`
			Version   string                 `json:"version"`
			Namespace string                 `json:"namespace"`
			Release   string                 `json:"release"`
			Values    map[string]interface{} `json:"values"`
		}
		err := json.NewDecoder(c.Request.Body).Decode(&requestData)
		if err != nil {
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

		log.Debug().Msg(fmt.Sprint(installOpts))

		err = installOpts.Validate()
		if err != nil {
			log.Error().Err(err).Msg("Error validating install options")
			http.Error(c.Writer, fmt.Sprintf("Invalid request data: %s", err.Error()), http.StatusBadRequest)
			return
		}

		// Create a response channel for the agent
		responseChan := make(chan *pb.ProxyResponse, 10000)
		ctx, cancel := context.WithCancel(c.Request.Context())

		streamID := uuid.New().String()

		agent.mutex.Lock()
		agent.requestChannels[streamID] = responseChan
		agent.cancelFuncs[streamID] = cancel
		agent.contexts[streamID] = ctx
		agent.mutex.Unlock()

		values, err := json.Marshal(requestData.Values)
		if err != nil {
			log.Error().Err(err).Msg("Error marshaling values")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Error marshaling values"})
			return
		}

		agent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_HelmInstallRequest{
				HelmInstallRequest: &pb.HelmInstallRequest{
					StreamId:  streamID,
					Repo:      requestData.Repo,
					RepoUrl:   requestData.RepoUrl,
					Chart:     requestData.Chart,
					Version:   requestData.Version,
					Namespace: requestData.Namespace,
					Release:   requestData.Release,
					Values:    values,
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

			if resp.Status == pb.ProxyResponseType_ERROR {
				log.Warn().Msg(string(resp.Body))
				c.JSON(http.StatusInternalServerError, gin.H{"error": string(resp.Body)})
				return
			}

			if resp.Status != pb.ProxyResponseType_DATA {
				log.Warn().Msg("Invalid response from agent")
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

			log.Warn().Msg("Agent connection closed unexpectedly")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
			return
		}
	})

	r.POST("/api/helm/install", func(c *gin.Context) {
		// Ready from json request body
		var requestData struct {
			Repo      string                 `json:"repo"`
			Chart     string                 `json:"chart"`
			Version   string                 `json:"version"`
			Namespace string                 `json:"namespace"`
			Release   string                 `json:"release"`
			Values    map[string]interface{} `json:"values"`
		}
		err := json.NewDecoder(c.Request.Body).Decode(&requestData)
		if err != nil {
			log.Error().Err(err).Msg("Error decoding request data")
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

	store := runner.NewExecutionStore()

	// runner example
	r.POST("/api/runner/execute", runner.HandleExecute(store))
	r.GET("/api/runner/executions/:id", runner.HandleGetExecution(store))
	r.GET("/api/runner/executions/:id/stream", runner.HandleStreamExecution(store))
	r.DELETE("/api/runner/executions/:id", runner.HandleTerminate(store))
	r.GET("/api/runner/executions", runner.HandleListExecutions(store))

	// AWS routes
	r.GET("/api/aws/instances", aws.ListEC2Instances)
	r.GET("api/aws/s3", aws.ListS3Buckets)

	r.GET("/api/agents/:agent/terminal/test", func(c *gin.Context) {
		log.Info().Msg("Hello world from terminal")
		agentID := c.Param("agent")
		agentsMutex.RLock()
		agent, exists := agentConnections[agentID]
		agentsMutex.RUnlock()

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
			return
		}

		upgrader := websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		}
		ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Error().Err(err).Msg("Failed to upgrade to WebSocket")
			return
		}

		streamID := uuid.New().String()
		ctx, cancel := context.WithCancel(c.Request.Context())

		// Prepare streaming
		agent.mutex.Lock()
		agent.terminalStreams[streamID] = ws
		agent.cancelFuncs[streamID] = cancel
		agent.contexts[streamID] = ctx
		agent.mutex.Unlock()

		// Send an init message to agent (optional)
		err = agent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_TerminalStream{
				TerminalStream: &pb.TerminalStream{
					Data:      []byte(fmt.Sprintf("INIT:%s", streamID)),
					SessionId: streamID,
				},
			},
		})
		if err != nil {
			log.Error().Err(err).Msg("Failed to send terminal init message to agent")
			return
		}

		// WS -> Agent stream
		go func() {
			for {
				_, msg, err := ws.ReadMessage()
				if err != nil {
					log.Warn().Err(err).Msg("WebSocket read failed, closing")
					cancel()
					ws.Close()
					return
				}
				err = agent.stream.Send(&pb.ServerMessage{
					Message: &pb.ServerMessage_TerminalStream{
						TerminalStream: &pb.TerminalStream{
							Data: msg,
						},
					},
				})
				if err != nil {
					log.Warn().Err(err).Msg("gRPC send failed, closing")
					cancel()
					return
				}
			}
		}()

		// Agent stream -> WS (handled elsewhere, maybe in your agent’s read loop)

		// Block until context done
		<-ctx.Done()
		log.Info().Msg("Done. doing cleanup now")
		ws.Close()
		// Cleanup
		agent.mutex.Lock()
		delete(agent.terminalStreams, streamID)
		delete(agent.cancelFuncs, streamID)
		delete(agent.contexts, streamID)
		agent.mutex.Unlock()
	})

	// dbui routes
	r.GET("/api/agent/:agent/dbui/:namespace/:dbname", func(c *gin.Context) {
		log.Info().Msg("Got the PGWEB http request")

		agentID := c.Param("agent")
		namespace := c.Param("namespace")
		dbName := c.Param("dbname")
		var dbType string
		if dbName == "elasticsearch" {
			dbType = "elasticsearch"
		} else {
			dbType = "postgresql"
		}

		agentsMutex.RLock()
		agent, exists := agentConnections[agentID]
		agentsMutex.RUnlock()

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
			return
		}

		streamID := uuid.New().String()
		responseChan := make(chan *pb.ProxyResponse, 10000)
		ctx, cancel := context.WithCancel(c.Request.Context())

		// Prepare streaming
		agent.mutex.Lock()
		agent.requestChannels[streamID] = responseChan
		agent.cancelFuncs[streamID] = cancel
		agent.contexts[streamID] = ctx
		agent.mutex.Unlock()

		agent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_DbuiRequest{
				DbuiRequest: &pb.DbUiRequest{
					DbName:    dbName,
					Namespace: namespace,
					StreamId:  streamID,
					DbType:    dbType,
				},
			},
		})

		// Handle the response stream

		select {
		case resp := <-responseChan:
			agent.mutex.Lock()
			delete(agent.requestChannels, streamID)
			delete(agent.cancelFuncs, streamID)
			delete(agent.contexts, streamID)
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
	// Ignore if it's not there, use regular env vars instead
	err := godotenv.Load()
	if err != nil {
		if err != nil && !os.IsNotExist(err) {
			log.Fatal().Err(err).Msg("Error loading .env file")
		}
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
