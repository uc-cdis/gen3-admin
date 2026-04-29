package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

func HandleTerminalTest(c *gin.Context) {
	log.Info().Msg("Hello world from terminal")
	agentID := c.Param("agent")
	agentsMutex.RLock()
	agent, exists := AgentConnections[agentID]
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

	agent.mutex.Lock()
	agent.terminalStreams[streamID] = ws
	agent.cancelFuncs[streamID] = cancel
	agent.contexts[streamID] = ctx
	agent.mutex.Unlock()

	err = agent.sendMessage(&pb.ServerMessage{
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

	go func() {
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				log.Warn().Err(err).Msg("WebSocket read failed, closing")
				cancel()
				ws.Close()
				return
			}
			err = agent.sendMessage(&pb.ServerMessage{
				Message: &pb.ServerMessage_TerminalStream{
					TerminalStream: &pb.TerminalStream{
						Data: msg,
					},
				},
			})
			if err != nil {
				log.Warn().Err(err).Msg("gRPC send failed, closing")
				cancel()
				ws.Close()
				return
			}
		}
	}()

	<-ctx.Done()
	log.Info().Msg("Done. doing cleanup now")
	ws.Close()

	agent.mutex.Lock()
	delete(agent.terminalStreams, streamID)
	delete(agent.cancelFuncs, streamID)
	delete(agent.contexts, streamID)
	agent.mutex.Unlock()
}

func HandleTerminalExec(c *gin.Context) {
	agentID := c.Param("agent")
	namespace := c.Param("namespace")
	pod := c.Param("pod")
	container := c.Param("container")

	agentsMutex.RLock()
	agent, exists := AgentConnections[agentID]
	agentsMutex.RUnlock()
	if !exists || agent.stream == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not connected"})
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Error().Err(err).Msg("WS upgrade failed")
		return
	}

	sessionID := uuid.New().String()
	ctx, cancel := context.WithCancel(c.Request.Context())

	agent.mutex.Lock()
	agent.terminalStreams[sessionID] = ws
	agent.cancelFuncs[sessionID] = cancel
	agent.contexts[sessionID] = ctx
	agent.mutex.Unlock()

	initPayload := map[string]any{
		"type":      "init",
		"sessionId": sessionID,
		"namespace": namespace,
		"pod":       pod,
		"container": container,
		"command":   []string{"sh"},
	}

	initBytes, _ := json.Marshal(initPayload)

	if err := agent.sendMessage(&pb.ServerMessage{
		Message: &pb.ServerMessage_TerminalStream{
			TerminalStream: &pb.TerminalStream{
				SessionId: sessionID,
				Data:      initBytes,
			},
		},
	}); err != nil {
		log.Error().Err(err).Msg("Failed to init exec session")
		ws.Close()
		return
	}

	go func() {
		defer cancel()
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil {
				log.Warn().Err(err).Msg("WS read failed")
				return
			}
			if err := agent.sendMessage(&pb.ServerMessage{
				Message: &pb.ServerMessage_TerminalStream{
					TerminalStream: &pb.TerminalStream{
						SessionId: sessionID,
						Data:      msg,
					},
				},
			}); err != nil {
				log.Warn().Err(err).Msg("gRPC send failed")
				return
			}
		}
	}()

	<-ctx.Done()

	agent.mutex.Lock()
	delete(agent.terminalStreams, sessionID)
	delete(agent.cancelFuncs, sessionID)
	delete(agent.contexts, sessionID)
	agent.mutex.Unlock()
	ws.Close()
}

// RegisterTerminalRoutes registers WebSocket terminal routes
func RegisterTerminalRoutes(r *gin.Engine) {
	r.GET("/api/agents/:agent/terminal/test", HandleTerminalTest)
	r.GET("/api/agents/:agent/terminal/exec/:namespace/:pod/:container", HandleTerminalExec)
}
