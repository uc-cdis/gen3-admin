package server

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"

	"github.com/uc-cdis/gen3-admin/internal/ca"
	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

type AgentServer struct {
	pb.UnimplementedTunnelServiceServer
	AgentConnections      map[string]pb.TunnelService_ConnectServer
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

func SetupGRCPServer() {
	creds, err := ca.SetupCerts()
	if err != nil {
		log.Fatal().Err(err).Msg("Error setting up certificates")
	}

	// Create and start gRPC server with TLS credentials
	s := grpc.NewServer(
		grpc.Creds(*creds),
	)

	pb.RegisterTunnelServiceServer(s, &AgentServer{})

	lis, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", 50051))
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to listen on port")
	}
	go s.Serve(lis)

	log.Info().Msg("GRPC Server listening on :50051")
}

func (s *AgentServer) Connect(stream pb.TunnelService_ConnectServer) error {
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

	var roleArn string
	var assumeMethod string
	var accessKey string
	var secretAccessKey string
	agentsMutex.RLock()
	if existing := AgentConnections[agentName]; existing != nil {
		roleArn = existing.agent.RoleARN
		assumeMethod = existing.agent.AssumeMethod
		accessKey = existing.agent.AccessKey
		secretAccessKey = existing.agent.SecretAccessKey
	}
	agentsMutex.RUnlock()

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

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to parse agent certificate")
		return err
	}

	// Check if the agent is already connected
	agentsMutex.Lock()
	existingAgent, exists := AgentConnections[agentName]
	if exists && existingAgent.stream != nil {
		// If there's an existing connection, disconnect the old one
		log.Warn().Msgf("Agent %s is already connected. Replacing the connection.", agentName)
		agentsMutex.Unlock()

		existingAgent.stream.Send(&pb.ServerMessage{
			Message: &pb.ServerMessage_Registration{
				Registration: &pb.RegistrationResponse{
					Message: "Agent is already connected. Replacing the connection.",
					Success: false,
				},
			},
		})

		time.Sleep(1 * time.Second)
		agentsMutex.Lock()

		delete(AgentConnections, agentName)

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
			Id:              cert.Subject.SerialNumber,
			Name:            agentName,
			Connected:       true,
			LastSeen:        time.Now(),
			RoleARN:         roleArn,
			AssumeMethod:    assumeMethod,
			AccessKey:       accessKey,
			SecretAccessKey: secretAccessKey,
		},
	}

	AgentConnections[agentName] = agent
	agentsMutex.Unlock()

	log.Info().Msgf("Agent %s connected", agentName)

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
			AgentConnections[agentName] = &AgentConnection{
				agent: Agent{
					Connected: false,
				},
			}
			agentsMutex.Unlock()

			agent.mutex.Lock()
			for _, cancel := range agent.cancelFuncs {
				cancel()
			}
			agent.mutex.Unlock()

			return err
		}

		switch msg := agentMessage.Message.(type) {
		case *pb.AgentMessage_Registration:
			log.Debug().Msgf("Received registration from agent %s: %v", agentName, msg.Registration)
			agentsMutex.Lock()
			AgentConnections[agentName] = agent
			agentsMutex.Unlock()

		case *pb.AgentMessage_Status:
			log.Debug().Msgf("Received status update from agent %s: %v", agentName, msg.Status)
			agentsMutex.Lock()
			agent := AgentConnections[agentName]
			agent.agent.LastSeen = time.Now()
			agent.agent.CpuUsage = msg.Status.CpuUsage
			agent.agent.MemoryUsage = msg.Status.MemoryUsage
			agent.agent.Connected = true
			agent.agent.Provider = msg.Status.Provider
			agent.agent.K8sVersion = msg.Status.K8SVersion
			AgentConnections[agentName] = agent
			agentsMutex.Unlock()
		case *pb.AgentMessage_Proxy:
			proxyResp := msg.Proxy
			agent.mutex.Lock()
			responseChan, exists := agent.requestChannels[proxyResp.StreamId]
			if exists {
				select {
				case responseChan <- proxyResp:
					log.Trace().Msgf("Response sent to channel for stream ID: %s", proxyResp.StreamId)
				case <-time.After(3 * time.Second):
					log.Trace().Msgf("Timed out trying to send response for stream ID: %s", proxyResp.StreamId)
				case <-agent.contexts[proxyResp.StreamId].Done():
					log.Trace().Msgf("Request cancelled for stream ID: %s", proxyResp.StreamId)
					delete(agent.requestChannels, proxyResp.StreamId)
					delete(agent.cancelFuncs, proxyResp.StreamId)
				default:
					log.Warn().Msgf("Channel is full for stream ID: %s", proxyResp.StreamId)
				}
			} else {
				log.Warn().Msgf("Received response for unknown stream ID: %s", proxyResp.StreamId)
			}
			agent.mutex.Unlock()
		case *pb.AgentMessage_TerminalStream:
			termResp := msg.TerminalStream
			log.Debug().Msgf("Received terminal stream from server %s: %v", agentName, termResp.Data)
			agent.mutex.Lock()
			webSocket, exists := agent.terminalStreams[termResp.SessionId]
			agent.mutex.Unlock()

			if exists {
				err := webSocket.WriteMessage(websocket.TextMessage, termResp.Data)
				if err != nil {
					log.Warn().Err(err).Msgf("Failed to write TerminalStream to WebSocket for session ID: %s", termResp.SessionId)

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
