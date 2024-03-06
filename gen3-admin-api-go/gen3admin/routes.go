package gen3admin

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/uc-cdis/gen3-admin/gen3admin/cluster"
	"github.com/uc-cdis/gen3-admin/gen3admin/deployments"
	dep "github.com/uc-cdis/gen3-admin/gen3admin/deployments"
	"github.com/uc-cdis/gen3-admin/gen3admin/jobs"
	"github.com/uc-cdis/gen3-admin/gen3admin/pods"
	"github.com/uc-cdis/gen3-admin/gen3admin/psql"
)

func Routes(route *gin.Engine) {
	pods := route.Group("/pods")
	{
		pods.GET("/", GetPods)
		pods.GET("/ws", func(c *gin.Context) {
			wshandler(c.Writer, c.Request)
		})
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
	}

	psql := route.Group("/psql")
	{
		psql.GET("/", GetSecrets)
	}
	jobs := route.Group("/jobs")
	{
		jobs.GET("/options", GetJobs)
	}
}

func GetSecrets(c *gin.Context) {

	secrets := psql.GetDBSecrets()

	c.JSON(200, secrets)
}

func GetJobs(c *gin.Context) {

	jobs, err := jobs.GetJobOptions(c)
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
	}

	c.JSON(200, jobs)
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
	deployments, err := dep.GetDeployments(c)
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	c.JSON(200, deployments)
}

func PodsPerDeployment(c *gin.Context) {
	name := c.Param("name")
	pods, err := deployments.GetPodsForDeployment(c, name)
	if err != nil {
		c.JSON(500, gin.H{
			"message": "error",
		})
		return
	}
	if len(pods.Pods) == 0 {
		c.JSON(404, gin.H{
			"message": "not found",
		})
		return
	}
	c.JSON(200, pods)
}

func GetPods(c *gin.Context) {

	// err := pods.ListPods(*gin.Context)
	c.JSON(200, gin.H{
		"message": "podpong",
	})
}

var wsupgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func wshandler(w http.ResponseWriter, r *http.Request) {
	wsupgrader.CheckOrigin = func(r *http.Request) bool { return true }
	conn, err := wsupgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("Failed to set websocket upgrade: %+v", err)
		return
	}
	defer conn.Close()

	err = pods.ExecIntoPod(conn)
	if err != nil {
		fmt.Println("Failed to exec into pod: %+v", err)
		return
	}
}
