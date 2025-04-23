package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
	"github.com/uc-cdis/gen3-admin/pkg/awspkg"
	"github.com/uc-cdis/gen3-admin/pkg/cluster"
	"github.com/uc-cdis/gen3-admin/pkg/deployments"
	"github.com/uc-cdis/gen3-admin/pkg/jobs"
	"github.com/uc-cdis/gen3-admin/pkg/pods"
	"github.com/uc-cdis/gen3-admin/pkg/psql"
	"github.com/uc-cdis/gen3-admin/pkg/squid"
	"github.com/uc-cdis/gen3-admin/pkg/types"
)

type ExecRequest struct {
	InstanceID string `json:"instanceId" binding:"required"`
	Region     string `json:"region" binding:"required"`
}

func Routes(route *gin.Engine) {
	pods := route.Group("/pods")
	{
		pods.GET("/", GetPods)
		pods.GET("/ws/:namespace/:pod/:container", func(c *gin.Context) {
			execWSHandler(c)
		})
		pods.GET("/logs/:namespace/:pod/:container", GetLogs)
	}
	deployments := route.Group("/deployments")
	{
		deployments.GET("", GetDeployments)
		deployments.GET("/:name", PodsPerDeployment)
	}
	cluster := route.Group("/cluster")
	{
		cluster.GET("/", GetClusterVersion)
		cluster.GET("/version", GetClusterVersionSimple)
		cluster.GET("/events", GetClusterEvents)
		cluster.GET("/capacity", GetClusterCapacity)
	}

	psql := route.Group("/psql")
	{
		psql.GET("/", GetSecrets)
	}

	cronjobs := route.Group("/cronjobs")
	{
		cronjobs.GET("/options", GetJobOptions)
		cronjobs.GET("/jobs/:name", GetJobInstances)
		// jobs.GET("/instances", GetJobStatus)
	}

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

func GetSecrets(c *gin.Context) {

	secrets := psql.GetDBSecrets()

	c.JSON(200, secrets)
}

func GetJobOptions(c *gin.Context) {

	jobs, err := jobs.GetJobOptions(c)
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
	}

	c.JSON(200, jobs)
}

func GetJobInstances(c *gin.Context) {
	name := c.Param("name")
	instances, err := jobs.GetJobInstances(c, name)
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
	}

	c.JSON(200, instances)
}

func GetClusterVersionSimple(c *gin.Context) {
	simpleVersion, err := cluster.GetClusterVersionSimple()
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}

	c.JSON(200, simpleVersion)
}

func GetClusterVersion(c *gin.Context) {
	clusterVersion, err := cluster.GetClusterVersion()
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	c.JSON(200, clusterVersion)
}

func GetDeployments(c *gin.Context) {
	deploymentList, err := deployments.GetDeployments(c)
	if err != nil {
		fmt.Println(err)
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	c.JSON(200, deploymentList)
}

func PodsPerDeployment(c *gin.Context) {
	name := c.Param("name")
	pods, err := deployments.GetPodsForDeployment(c, name)
	if err != nil {
		fmt.Println(err)
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	if len(*pods) == 0 {
		c.JSON(404, gin.H{
			"message": "not found",
		})
		return
	}
	c.JSON(200, pods)
}

func GetPods(c *gin.Context) {
	pods, err := pods.ListPods(c)
	if err != nil {
		fmt.Println(err)
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	c.JSON(200, pods)
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

func execWSHandler(c *gin.Context) {
	w := c.Writer
	r := c.Request
	namespace := c.Param("namespace")
	pod := c.Param("pod")
	container := c.Param("container")

	wsupgrader.CheckOrigin = func(r *http.Request) bool { return true }
	conn, err := wsupgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("Failed to set websocket upgrade: %+v", err)
		return
	}
	defer conn.Close()

	err = pods.ExecIntoPod(conn, namespace, pod, container)
	if err != nil {
		fmt.Println("Failed to exec into pod: %+v", err)
		return
	}
}

func GetLogs(c *gin.Context) {

	setStreamHeaders(c)

	namespace := c.Param("namespace")
	pod := c.Param("pod")
	container := c.Param("container")

	// Stream logs from Kubernetes API server
	logs := make(chan types.LogMessage)
	done := make(chan struct{})
	errCh := make(chan error)
	go func() {
		err := pods.GetLogs(namespace, pod, container, c, logs, errCh, done)
		if err != nil {
			fmt.Println(err)
			errCh <- err
		}
	}()

	streamLogsToClient(c, logs, errCh, done)

	// logs, err :=
	// if err != nil {
	// 	c.JSON(500, gin.H{
	// 		"message": "error",
	// 	})
	// 	return
	// }
	// c.JSON(200, logs)
}

// setHeaders sets headers for the SSE response
func setStreamHeaders(c *gin.Context) {
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("Transfer-Encoding", "chunked")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
	c.Writer.Header().Set("Access-Control-Max-Age", "86400")
}

// streamLogsToClient
func streamLogsToClient(c *gin.Context, logs chan types.LogMessage, errCh chan error, done chan struct{}) {
	for {
		select {
		// received new log line in go channel
		case log := <-logs:
			c.SSEvent(log.Type, log)
			c.Writer.Flush()
		case err := <-errCh:
			c.SSEvent("error", err.Error())
			return
			// channel should be closed
		case <-c.Writer.CloseNotify():
			close(done)
			return
		}
	}
}

func GetClusterEvents(c *gin.Context) {
	events, err := cluster.GetClusterEvents(c)
	if err != nil {
		fmt.Println(err)
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	c.JSON(200, events)
}

func GetClusterCapacity(c *gin.Context) {
	capacity, err := cluster.GetClusterCapacity(c)
	if err != nil {
		fmt.Println(err)
		c.JSON(500, gin.H{
			"message": "error",
			"error":   err.Error(),
		})
		return
	}
	c.JSON(200, capacity)
}
