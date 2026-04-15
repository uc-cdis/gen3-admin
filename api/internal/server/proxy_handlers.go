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

	err := agent.stream.Send(&pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: proxyReq,
		},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send request to agent"})
		return
	}

	var responseStarted bool
	for {
		select {
		case resp, ok := <-responseChan:
			if !ok {
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
				}
			case pb.ProxyResponseType_DATA:
				if !responseStarted {
					responseStarted = true
				}
				_, err := c.Writer.Write(resp.Body)
				if err != nil {
					log.Error().Err(err).Msg("Failed to write response body chunk")
					return
				}
			case pb.ProxyResponseType_END:
				c.Writer.Flush()
				c.Abort()
				return
			case pb.ProxyResponseType_ERROR:
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

	err := agent.stream.Send(&pb.ServerMessage{
		Message: &pb.ServerMessage_Proxy{
			Proxy: proxyReq,
		},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send request to agent"})
		return
	}

	var responseStarted bool
	for {
		select {
		case resp, ok := <-responseChan:
			if !ok {
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
				}
			case pb.ProxyResponseType_DATA:
				if !responseStarted {
					responseStarted = true
				}
				_, err := c.Writer.Write(resp.Body)
				if err != nil {
					log.Error().Err(err).Msg("Failed to write response body chunk")
					return
				}
			case pb.ProxyResponseType_END:
				c.Writer.Flush()
				c.Abort()
				return
			case pb.ProxyResponseType_ERROR:
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

// RegisterProxyRoutes registers K8s and HTTP proxy routes
func RegisterProxyRoutes(protected *gin.RouterGroup) {
	protected.Any("/api/k8s/:agent/proxy/*path", func(c *gin.Context) {
		log.Info().Msgf("Proxying agent k8s request to: %s", c.Request.URL.String())
		HandleK8sProxyRequest(c)
	})

	protected.Any("/api/agents/:agent/http", HandleAgentHTTPProxyRequest)
}
