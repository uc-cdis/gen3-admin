package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strings"

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
	// Validate input *before* upgrading, so a bad request gets an HTTP 400 the
	// client can actually read rather than a successful 101 followed by an error
	// frame on a socket that is already open.
	instanceId := c.Query("instanceId")
	if instanceId == "" {
		log.Warn().Msg("missing instanceId")
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing instanceId query parameter"})
		return
	}

	if !validInstanceID.MatchString(instanceId) {
		log.Warn().Str("instanceId", instanceId).Msg("rejecting malformed instanceId")
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid instanceId format"})
		return
	}

	conn, err := wsupgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		// Upgrade already wrote an HTTP error response (e.g. 403 on origin
		// rejection), so do not write another one here.
		log.Error().Err(err).Msg("failed to upgrade websocket")
		return
	}
	defer conn.Close()

	conn.WriteMessage(websocket.TextMessage, []byte("Connected to instance. Press any key to start...\r\n"))

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

// validInstanceID matches EC2 instance IDs (i-<8 or 17 hex chars>). Validating
// this before opening an SSM session keeps arbitrary caller-supplied targets out
// of the AWS API call.
var validInstanceID = regexp.MustCompile(`^i-[0-9a-f]{8}([0-9a-f]{9})?$`)

var wsupgrader = websocket.Upgrader{
	CheckOrigin: checkWebSocketOrigin,

	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// checkWebSocketOrigin enforces the same origin allowlist as CORS. Browsers do
// not apply the CORS policy to WebSocket handshakes, so without this any site a
// logged-in user visits could open a socket using their cookie and get an
// interactive SSM shell.
func checkWebSocketOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Non-browser client (CLI, test harness); no ambient cookie to abuse.
		return true
	}

	allowed := strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",")
	for _, a := range allowed {
		if trimmed := strings.TrimSpace(a); trimmed != "" && trimmed == origin {
			return true
		}
	}

	// Same-origin requests are always safe: the Host the browser connected to
	// matches the Origin it claims.
	if u, err := url.Parse(origin); err == nil && u.Host == r.Host {
		return true
	}

	log.Warn().Str("origin", origin).Str("host", r.Host).
		Msg("rejecting websocket upgrade from disallowed origin")
	return false
}
