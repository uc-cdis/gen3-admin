package server

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

func HandleK8sProxyRequest(c *gin.Context) {
	agentID := c.Param("agent")
	path := c.Param("path")
	queryString := c.Request.URL.Query().Encode()

	var wg sync.WaitGroup

	agentsMutex.RLock()
	agent, exists := AgentConnections[agentID]
	agentsMutex.RUnlock()
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		log.Warn().Msgf("Agent not found: %s", agentID)
		return
	}

	streamID := uuid.New().String()
	responseChan := make(chan *pb.ProxyResponse, 10000)
	ctx, cancel := context.WithCancel(c.Request.Context())

	log.Info().
		Str("stream_id", streamID).
		Str("agent", agentID).
		Str("method", c.Request.Method).
		Str("path", path).
		Msg("[proxy-handler] Starting k8s proxy request")

	agent.mutex.Lock()
	agent.requestChannels[streamID] = responseChan
	agent.cancelFuncs[streamID] = cancel
	agent.contexts[streamID] = ctx
	agent.mutex.Unlock()

	// sendCancel sends a CANCEL message to the agent so it stops streaming
	sendCancel := func(reason string) {
		log.Warn().
			Str("stream_id", streamID).
			Str("reason", reason).
			Msg("[proxy-handler] Sending CANCEL to agent")
		_ = agent.sendMessage(&pb.ServerMessage{
			Message: &pb.ServerMessage_Proxy{
				Proxy: &pb.ProxyRequest{
					StreamId:  streamID,
					Method:    "CANCEL",
					Path:      "",
					ProxyType: "k8s",
				},
			},
		})
	}

	defer func() {
		// Capture context error BEFORE cancelling (cancel() sets ctx.Err())
		ctxErr := ctx.Err()
		cancel()
		wg.Wait()

		// Only send CANCEL if the client actually disconnected/timed out (not normal completion)
		if ctxErr != nil {
			sendCancel("handler exiting with cancelled context")
		}

		agent.mutex.Lock()
		delete(agent.requestChannels, streamID)
		delete(agent.cancelFuncs, streamID)
		delete(agent.contexts, streamID)
		agent.mutex.Unlock()
		close(responseChan)

		log.Info().
			Str("stream_id", streamID).
			Str("agent", agentID).
			Msg("[proxy-handler] Cleaned up proxy request")
	}()

	proxyReq := &pb.ProxyRequest{
		StreamId:  streamID,
		Method:    c.Request.Method,
		Path:      path + "?" + queryString,
		Headers:   make(map[string]string),
		Body:      nil,
		ProxyType: "k8s",
	}

	for k, v := range c.Request.Header {
		proxyReq.Headers[k] = strings.Join(v, ",")
	}

	if c.Request.Body != nil {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
			return
		}
		proxyReq.Body = body
	}

	err := agent.sendMessage(&pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: proxyReq,
		},
	})
	if err != nil {
		log.Error().
			Err(err).
			Str("stream_id", streamID).
			Msg("[proxy-handler] Failed to send request to agent")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send request to agent"})
		return
	}

	log.Info().
		Str("stream_id", streamID).
		Str("agent", agentID).
		Msg("[proxy-handler] Sent request to agent, waiting for response")

	var responseStarted bool
	chunkCount := 0
	for {
		select {
		case resp, ok := <-responseChan:
			if !ok {
				log.Warn().
					Str("stream_id", streamID).
					Bool("response_started", responseStarted).
					Msg("[proxy-handler] Agent connection closed unexpectedly")
				if !responseStarted {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
				}
				return
			}
			switch resp.Status {
			case pb.ProxyResponseType_HEADERS:
				if !responseStarted {
					responseStarted = true
					for k, v := range resp.Headers {
						c.Header(k, v)
					}
					c.Status(int(resp.StatusCode))
					log.Info().
						Str("stream_id", streamID).
						Int32("status_code", resp.StatusCode).
						Msg("[proxy-handler] Received HEADERS from agent")
				}
			case pb.ProxyResponseType_DATA:
				if !responseStarted {
					responseStarted = true
				}
				chunkCount++
				_, err := c.Writer.Write(resp.Body)
				if err != nil {
					log.Error().
						Err(err).
						Str("stream_id", streamID).
						Int("chunk", chunkCount).
						Msg("[proxy-handler] Failed to write response body chunk")
					return
				}
				c.Writer.Flush()
			case pb.ProxyResponseType_END:
				log.Info().
					Str("stream_id", streamID).
					Int("total_chunks", chunkCount).
					Msg("[proxy-handler] Received END, request complete")
				c.Writer.Flush()
				c.Abort()
				return
			case pb.ProxyResponseType_ERROR:
				log.Warn().
					Str("stream_id", streamID).
					Str("error", string(resp.Body)).
					Msg("[proxy-handler] Received ERROR from agent")
				if !responseStarted {
					responseStarted = true
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": string(resp.Body)})
				return
			default:
				log.Warn().Msgf("Unknown message type from stream %s: %T", streamID, resp)
			}

		case <-ctx.Done():
			log.Warn().
				Str("stream_id", streamID).
				Bool("response_started", responseStarted).
				Int("chunks_received", chunkCount).
				Err(ctx.Err()).
				Msg("[proxy-handler] Context cancelled, exiting handler")
			if responseStarted {
				c.Writer.Flush()
			}
			return
		}
	}
}

func HandleAgentHTTPProxyRequest(c *gin.Context) {
	agentID := c.Param("agent")
	targetURL := c.Query("url")

	if targetURL == "" {
		c.JSON(400, gin.H{"error": "missing url query param"})
		return
	}

	var wg sync.WaitGroup

	agentsMutex.RLock()
	agent, exists := AgentConnections[agentID]
	agentsMutex.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
		log.Warn().Msgf("Agent not found: %s", agentID)
		return
	}

	streamID := uuid.New().String()
	responseChan := make(chan *pb.ProxyResponse, 10000)
	ctx, cancel := context.WithCancel(c.Request.Context())

	log.Info().
		Str("stream_id", streamID).
		Str("agent", agentID).
		Str("method", c.Request.Method).
		Str("url", targetURL).
		Msg("[proxy-handler] Starting HTTP proxy request")

	agent.mutex.Lock()
	agent.requestChannels[streamID] = responseChan
	agent.cancelFuncs[streamID] = cancel
	agent.contexts[streamID] = ctx
	agent.mutex.Unlock()

	sendCancel := func(reason string) {
		log.Warn().
			Str("stream_id", streamID).
			Str("reason", reason).
			Msg("[proxy-handler] Sending CANCEL to agent")
		_ = agent.sendMessage(&pb.ServerMessage{
			Message: &pb.ServerMessage_Proxy{
				Proxy: &pb.ProxyRequest{
					StreamId:  streamID,
					Method:    "CANCEL",
					Path:      "",
					ProxyType: "http",
				},
			},
		})
	}

	defer func() {
		ctxErr := ctx.Err()
		cancel()
		wg.Wait()

		if ctxErr != nil {
			sendCancel("handler exiting with cancelled context")
		}

		agent.mutex.Lock()
		delete(agent.requestChannels, streamID)
		delete(agent.cancelFuncs, streamID)
		delete(agent.contexts, streamID)
		agent.mutex.Unlock()
		close(responseChan)

		log.Info().
			Str("stream_id", streamID).
			Str("agent", agentID).
			Msg("[proxy-handler] Cleaned up HTTP proxy request")
	}()

	proxyReq := &pb.ProxyRequest{
		StreamId:  streamID,
		Method:    c.Request.Method,
		Path:      targetURL,
		Headers:   make(map[string]string),
		Body:      nil,
		ProxyType: "http",
	}

	for k, v := range c.Request.Header {
		proxyReq.Headers[k] = strings.Join(v, ",")
	}

	if c.Request.Body != nil {
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read request body"})
			return
		}
		proxyReq.Body = body
	}

	err := agent.sendMessage(&pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: proxyReq,
		},
	})
	if err != nil {
		log.Error().
			Err(err).
			Str("stream_id", streamID).
			Msg("[proxy-handler] Failed to send request to agent")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send request to agent"})
		return
	}

	log.Info().
		Str("stream_id", streamID).
		Str("agent", agentID).
		Msg("[proxy-handler] Sent HTTP proxy request to agent, waiting for response")

	var responseStarted bool
	chunkCount := 0
	for {
		select {
		case resp, ok := <-responseChan:
			if !ok {
				log.Warn().
					Str("stream_id", streamID).
					Bool("response_started", responseStarted).
					Msg("[proxy-handler] Agent connection closed unexpectedly")
				if !responseStarted {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
				}
				return
			}
			switch resp.Status {
			case pb.ProxyResponseType_HEADERS:
				if !responseStarted {
					responseStarted = true
					for k, v := range resp.Headers {
						c.Header(k, v)
					}
					c.Status(int(resp.StatusCode))
					log.Info().
						Str("stream_id", streamID).
						Int32("status_code", resp.StatusCode).
						Msg("[proxy-handler] Received HEADERS from agent")
				}
			case pb.ProxyResponseType_DATA:
				if !responseStarted {
					responseStarted = true
				}
				chunkCount++
				_, err := c.Writer.Write(resp.Body)
				if err != nil {
					log.Error().
						Err(err).
						Str("stream_id", streamID).
						Int("chunk", chunkCount).
						Msg("[proxy-handler] Failed to write response body chunk")
					return
				}
				c.Writer.Flush()
			case pb.ProxyResponseType_END:
				log.Info().
					Str("stream_id", streamID).
					Int("total_chunks", chunkCount).
					Msg("[proxy-handler] Received END, request complete")
				c.Writer.Flush()
				c.Abort()
				return
			case pb.ProxyResponseType_ERROR:
				log.Warn().
					Str("stream_id", streamID).
					Str("error", string(resp.Body)).
					Msg("[proxy-handler] Received ERROR from agent")
				if !responseStarted {
					responseStarted = true
				}
				c.JSON(http.StatusInternalServerError, gin.H{"error": string(resp.Body)})
				return
			default:
				log.Warn().Msgf("Unknown message type from stream %s: %T", streamID, resp)
			}

		case <-ctx.Done():
			log.Warn().
				Str("stream_id", streamID).
				Bool("response_started", responseStarted).
				Int("chunks_received", chunkCount).
				Err(ctx.Err()).
				Msg("[proxy-handler] Context cancelled, exiting handler")
			if responseStarted {
				c.Writer.Flush()
			}
			return
		}
	}
}

// RegisterProxyRoutes registers K8s and HTTP proxy routes
func RegisterProxyRoutes(protected *gin.RouterGroup) {
	protected.Any("/api/k8s/:agent/proxy/*path", func(c *gin.Context) {
		log.Info().Msgf("Proxying agent k8s request to: %s", c.Request.URL.String())
		HandleK8sProxyRequest(c)
	})

	protected.Any("/api/agents/:agent/http", HandleAgentHTTPProxyRequest)
}
