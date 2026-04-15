package server

import (
	"crypto/elliptic"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/uc-cdis/gen3-admin/internal/aws"
	"github.com/uc-cdis/gen3-admin/internal/k8s"
	"github.com/uc-cdis/gen3-admin/internal/logger"
	"github.com/uc-cdis/gen3-admin/internal/middleware/keycloak"
	"github.com/uc-cdis/gen3-admin/internal/runner"
	"github.com/uc-cdis/gen3-admin/internal/terraform"
	routes "github.com/uc-cdis/gen3-admin/pkg"
)

var (
	agentsMutex     sync.RWMutex
	CertCurve       = elliptic.P384()
	AgentConnections = make(map[string]*AgentConnection)
	validAgentName   = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

func SetupHTTPServer() {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(logger.DefaultStructuredLogger())
	r.Use(gin.Recovery())

	r.Use(cors.Default())
	r.RedirectTrailingSlash = false

	go func() {
		fmt.Println(http.ListenAndServe("localhost:6060", nil))
	}()

	mockAuth := os.Getenv("MOCK_AUTH") == "true"
	if mockAuth {
		log.Warn().Msg("MOCK_AUTH mode enabled - no real authentication is being applied! This should *NEVER* be used in production.")
		r.Use(keycloak.SuccessMiddleware())
	} else {
		r.Use(keycloak.AuthMiddleware())
	}

	// Ping
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "pong"})
	})

	// Environment detection (public, no auth required)
	r.GET("/api/environment", GetEnvironmentHandler)

	// External routes (from pkg package)
	routes.Routes(r)

	// Set up reverse proxy for k8s API
	proxy, err := k8s.SetupReverseProxy()
	if err != nil {
		panic(err)
	}

	protected := r.Group("/")
	if mockAuth {
		protected.Use(keycloak.SuccessMiddleware())
	} else {
		protected.Use(keycloak.AuthMiddleware())
	}

	{
		protected.Any("/api/k8s/proxy/*path", func(c *gin.Context) {
			requestPath := strings.TrimPrefix(c.Request.URL.Path, "/api/k8s/proxy")
			c.Request.URL.Path = requestPath
			log.Info().Msgf("Proxying request to: %s", c.Request.URL.String())
			proxy.ServeHTTP(c.Writer, c.Request)
		})

	}

	// Register route groups from extracted handler files
	RegisterAgentRoutes(r)
	RegisterProxyRoutes(protected)
	RegisterHelmRoutes(r)
	RegisterTerminalRoutes(r)
	RegisterDbUiRoutes(r)

	// Bootstrap endpoints (public, for workshop/onboarding)
	r.POST("/api/bootstrap/argocd", InstallArgoCDHandler)
	r.POST("/api/bootstrap/apps", InstallAppsHandler)
	r.GET("/api/bootstrap/status", BootstrapStatusHandler)
	r.POST("/api/bootstrap/alloy", InstallAlloyHandler)
	r.GET("/api/bootstrap/configmap", ConfigMapHandler)
	r.POST("/api/bootstrap/configmap", ConfigMapHandler)

	// Runner routes
	store := runner.NewExecutionStore()
	r.POST("/api/runner/execute", runner.HandleExecute(store))
	r.GET("/api/runner/executions/:id", runner.HandleGetExecution(store))
	r.GET("/api/runner/executions/:id/stream", runner.HandleStreamExecution(store))
	r.DELETE("/api/runner/executions/:id", runner.HandleTerminate(store))
	r.GET("/api/runner/executions", runner.HandleListExecutions(store))

	// Terraform routes
	r.POST("/api/terraform/execute", terraform.HandleTerraformExecute())
	r.GET("/api/terraform/executions/:id", terraform.HandleGetTerraformExecution())
	r.GET("/api/terraform/executions/:id/stream", terraform.HandleStreamTerraformExecution())
	r.DELETE("/api/terraform/executions/:id", terraform.HandleTerminateTerraform())
	r.GET("/api/terraform/executions", terraform.HandleListTerraformExecutions())
	r.POST("/api/terraform/bootstrap-secret", terraform.HandleBootstrapAWSSecret())

	// AWS routes
	r.GET("/api/aws/identity", aws.GetCallerIdentity)
	r.GET("/api/aws/profiles", aws.ListAWSProfilesHandler)
	r.POST("/api/aws/set-profile", aws.SetAWSProfileHandler)
	r.GET("/api/aws/instances", aws.ListEC2Instances)
	r.GET("/api/aws/s3", aws.ListS3Buckets)

	// Static files
	r.Static("/static", "./static")
	r.Routes()

	log.Info().Msg("Starting API server")

	err = r.Run(":8002")
	if err != nil {
		log.Fatal().Err(err).Msg("Error starting HTTP server")
	}
}
