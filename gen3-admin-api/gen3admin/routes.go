package routes

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/uc-cdis/gen3-admin/gen3admin/cluster"
	"github.com/uc-cdis/gen3-admin/gen3admin/deployments"
	"github.com/uc-cdis/gen3-admin/gen3admin/jobs"
	"github.com/uc-cdis/gen3-admin/gen3admin/pods"
	"github.com/uc-cdis/gen3-admin/gen3admin/psql"
	"github.com/uc-cdis/gen3-admin/gen3admin/types"
)

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
