package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/uc-cdis/gen3-admin/pkg/awspkg"
	"github.com/uc-cdis/gen3-admin/pkg/squid"
)

type ExecRequest struct {
	InstanceID string `json:"instanceId" binding:"required"`
	Region     string `json:"region" binding:"required"`
}

func Routes(route *gin.Engine) {

	squids := route.Group("/api/squid")
	{
		squids.GET("/asgs", squid.ListASGsHandler)
		squids.GET("/proxies", squid.GetProxiesHandler)
		squids.POST("/swap", squid.SwapProxyHandler)
	}

	ssm := route.Group("/api/ssm")
	{
		ssm.GET("/exec", ssmWebSocketHandler)
	}

	awsRoutes := route.Group("/api/aws")
	{
		awsRoutes.GET("/certificates", awspkg.ListCertificatesHandler)
	}
}

type pluginParams struct {
	Target     string               `json:"Target"`
	Parameters map[string][]*string `json:"Parameters"`
}

func ssmWebSocketHandler(c *gin.Context) {
	conn, err := wsupgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Error().Err(err).Msg("failed to upgrade websocket")
		c.JSON(500, gin.H{"error": "can't upgrade to ws"})
		return
	}
	defer conn.Close()

	conn.WriteMessage(websocket.TextMessage, []byte("Connected to instance. Press any key to start...\r\n"))
	instanceId := c.Query("instanceId")
	if instanceId == "" {
		log.Warn().Msg("missing instanceId")
		conn.WriteMessage(websocket.TextMessage, []byte("Missing instanceId query parameter"))
		return
	}

	region := "us-east-1"
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to load AWS config: "+err.Error()))
		return
	}

	ssmClient := ssm.NewFromConfig(cfg)
	session, err := ssmClient.StartSession(ctx, &ssm.StartSessionInput{
		Target: aws.String(instanceId),
	})
	if err != nil {
		log.Error().Err(err).Msg("failed to start SSM session")
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start SSM session: "+err.Error()))
		return
	}

	// sessionJSON := fmt.Sprintf(`{"SessionId":"%s","StreamUrl":"%s","TokenValue":"%s"}`,
	// 	*session.SessionId,
	// 	*session.StreamUrl,
	// 	*session.TokenValue,
	// )

	// Create plugin parameters string
	// pluginParams := fmt.Sprintf(`{"Target":"%s","Parameters":{}}`, instanceId)

	// Final formatted session-manager-plugin command
	// pluginCommand := fmt.Sprintf(
	// 	`session-manager-plugin '%s' %s StartSession '' '%s' 'https://ssm.%s.amazonaws.com'`,
	// 	sessionJSON,
	// 	region,
	// 	pluginParams,
	// 	region,
	// )

	// log.Info().Msgf("Run this in your terminal to test manually:\n\n%s\n", pluginCommand)

	// Prepare arguments for session-manager-plugin
	sessionJSON, _ := json.Marshal(session)
	paramStruct := pluginParams{
		Target:     instanceId,
		Parameters: map[string][]*string{},
	}
	paramJSON, _ := json.Marshal(paramStruct)

	endpoint := fmt.Sprintf("https://ssm.%s.amazonaws.com", region)

	cmd := exec.Command("session-manager-plugin",
		string(sessionJSON),
		region,
		"StartSession",
		"",
		string(paramJSON),
		endpoint,
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to create stdin pipe: "+err.Error()))
		return
	}
	defer stdin.Close()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to create stdout pipe: "+err.Error()))
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start session-manager-plugin: "+err.Error()))
		return
	}

	go func() {
		err := cmd.Wait()
		log.Info().Msgf("session-manager-plugin exited with: %v", err)
	}()

	done := make(chan struct{})

	// WebSocket -> stdin
	go func() {
		defer close(done)
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				log.Warn().Err(err).Msg("websocket read error or closed by client")
				return
			}
			_, err = stdin.Write(msg)
			if err != nil {
				log.Warn().Err(err).Msg("stdin write failed")
				return
			}
		}
	}()

	// stdout -> WebSocket
	buf := make([]byte, 1024)
	for {
		select {
		case <-done:
			log.Info().Msg("stopping stdout writer loop")
			return
		default:
			n, err := stdout.Read(buf)
			if err != nil {
				log.Warn().Err(err).Msg("stdout read error")
				return
			}
			// err = conn.WriteMessage(websocket.BinaryMessage, buf[:n])
			err = conn.WriteMessage(websocket.TextMessage, buf[:n])
			if err != nil {
				log.Warn().Err(err).Msg("websocket write error")
				return
			}
		}
	}

	// Wait for the command to finish before exiting
	cmd.Wait()
}

var wsupgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins — for dev/testing only
		return true

		// OR: Restrict to your frontend's origin
		// return r.Header.Get("Origin") == "https://your-frontend.com"
	},

	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}
