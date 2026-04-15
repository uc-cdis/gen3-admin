package server

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

func HandleDbUiProxy(c *gin.Context) {
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
	agent, exists := AgentConnections[agentID]
	agentsMutex.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agent not found"})
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
		delete(agent.requestChannels, streamID)
		delete(agent.cancelFuncs, streamID)
		delete(agent.contexts, streamID)
		agent.mutex.Unlock()

		c.JSON(http.StatusInternalServerError, gin.H{"error": "Agent connection closed unexpectedly"})
		return
	}
}

// RegisterDbUiRoutes registers database UI proxy routes
func RegisterDbUiRoutes(r *gin.Engine) {
	r.GET("/api/agent/:agent/dbui/:namespace/:dbname", HandleDbUiProxy)
}
