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
	agentsMutex      sync.RWMutex
	CertCurve        = elliptic.P384()
	AgentConnections = make(map[string]*AgentConnection)
	validAgentName   = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
)

// corsConfig builds the CORS policy from CORS_ALLOWED_ORIGINS (comma-separated).
// Credentials are allowed because the browser sends the keycloak-access-token
// cookie, and the CORS spec forbids pairing credentials with a wildcard origin —
// so an explicit origin list is required rather than merely preferred.
func corsConfig() cors.Config {
	cfg := cors.DefaultConfig()
	cfg.AllowCredentials = true
	cfg.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Requested-With"}
	cfg.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"}

	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	if raw == "" {
		// No configured origins: same-origin requests still work (the browser
		// does not apply CORS to them), but cross-origin ones are refused.
		//
		// This cannot be expressed as an empty AllowOrigins: cors.New panics
		// with "conflict settings: all origins disabled" on a config that
		// permits nothing, taking the whole process down at startup. Use a
		// predicate that rejects every origin instead, which is the same policy
		// without the panic.
		log.Warn().Msg("CORS_ALLOWED_ORIGINS is not set; all cross-origin browser requests will be rejected")
		cfg.AllowOrigins = nil
		cfg.AllowOriginFunc = func(string) bool { return false }
		return cfg
	}

	var origins []string
	for _, o := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	cfg.AllowOrigins = origins
	log.Info().Strs("origins", origins).Msg("CORS allowed origins configured")
	return cfg
}

// serviceAccountTokenPath is mounted into every pod by kubelet. Its presence is a
// reliable signal that we are running inside a Kubernetes cluster.
const serviceAccountTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"

// certsDir holds the agent client certificates issued by internal/ca.
const certsDir = "certs"

// assertMockAuthAllowed refuses to start when MOCK_AUTH is combined with an
// in-cluster deployment. MOCK_AUTH bypasses authentication entirely and grants
// superadmin with visibility of every agent, so shipping it to a cluster exposes
// an unauthenticated API with the service account's full privileges. Local and
// workshop setups (docker-compose, bare `go run`) are unaffected; a cluster
// deployment that genuinely needs it must opt in explicitly.
func assertMockAuthAllowed() {
	if _, err := os.Stat(serviceAccountTokenPath); err != nil {
		// Not running in-cluster; mock auth is a local convenience.
		return
	}

	if os.Getenv("ALLOW_INSECURE_MOCK_AUTH") == "true" {
		log.Error().Msg("MOCK_AUTH is enabled IN-CLUSTER with ALLOW_INSECURE_MOCK_AUTH=true. " +
			"This API is UNAUTHENTICATED and grants superadmin to anyone who can reach it. " +
			"Use this only for disposable workshop or test clusters.")
		return
	}

	log.Fatal().Msg("refusing to start: MOCK_AUTH=true detected while running in-cluster. " +
		"Mock auth disables authentication and grants superadmin to every request. " +
		"Set MOCK_AUTH=false (recommended), or set ALLOW_INSECURE_MOCK_AUTH=true to " +
		"acknowledge the risk on a disposable cluster.")
}

func SetupHTTPServer() {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(logger.DefaultStructuredLogger())
	r.Use(gin.Recovery())

	r.Use(cors.New(corsConfig()))
	r.RedirectTrailingSlash = false

	go func() {
		fmt.Println(http.ListenAndServe("localhost:6060", nil))
	}()

	mockAuth := os.Getenv("MOCK_AUTH") == "true"
	if mockAuth {
		assertMockAuthAllowed()
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
	RegisterArgoCDRoutes(protected)
	RegisterHelmRoutes(r)
	RegisterTerminalRoutes(r)
	RegisterTunnelRoutes(r)
	RegisterSqlRoutes(r)
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
