// Setup MUX for API

package main

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	routes "github.com/uc-cdis/gen3-admin/gen3admin"

	"go.uber.org/zap"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

// setupReverseProxy creates a reverse proxy using Kubernetes API server URL and configured transport
func setupReverseProxy() (*httputil.ReverseProxy, error) {
	var config *rest.Config
	var err error

	// Attempt to use in-cluster config
	config, err = rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig file
		kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			panic(err) // Handle error appropriately for your situation
		}
	}

	// Parse the API server URL from the config
	url, err := url.Parse(config.Host)
	if err != nil {
		return nil, err
	}

	// Create a reverse proxy
	proxy := httputil.NewSingleHostReverseProxy(url)

	// Set up the transport using the REST configuration
	transport, err := rest.TransportFor(config)
	if err != nil {
		return nil, err
	}

	// Assign the configured transport to the proxy
	proxy.Transport = transport

	return proxy, nil
}

func setUpGrafanRevproxy(grafanaURL *url.URL) (*httputil.ReverseProxy, error) {
	proxy := httputil.NewSingleHostReverseProxy(grafanaURL)

	return proxy, nil
}

func AuthMiddleWare(logger *zap.SugaredLogger) gin.HandlerFunc {
	// Do some initialization logic here
	// Foo()
	return func(c *gin.Context) {
		logger.Warn("Something is checking auth for path: ", c.FullPath())
		c.Next()
	}
}

func ForbiddenMiddleware(logger *zap.SugaredLogger) gin.HandlerFunc {
	return func(c *gin.Context) {
		logger.Warn("Not allowing due to authZ")
		c.AbortWithStatus(http.StatusForbidden) // Immediately abort and return 403
	}
}

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync() // flushes buffer, if any
	sugar := logger.Sugar()
	sugar.Debug("Setting up MUX for API")

	// mux := http.NewServeMux()
	// // hatchery.RegisterSystem(mux)
	// // hatchery.RegisterHatchery(mux)

	// // config.Logger.Printf("Running main")
	// logger.Info("Running main on port 8001")
	// log.Fatal(http.ListenAndServe("0.0.0.0:8001", mux))

	// uncomment the following to run the gin server
	r := gin.Default()
	r.Use(AuthMiddleWare(sugar))
	r.Static("/static", "./static")

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	gin.Logger()

	routes.Routes(r)

	proxy, err := setupReverseProxy()
	if err != nil {
		panic(err) // Handle error appropriately for your situation
	}

	r.Any("/api/k8s/proxy/*path", func(c *gin.Context) {
		requestPath := strings.TrimPrefix(c.Request.URL.Path, "/api/k8s/proxy")
		c.Request.URL.Path = requestPath

		// Log the outgoing request URL
		sugar.Infof("Proxying request to: %s", c.Request.URL.String())

		proxy.ServeHTTP(c.Writer, c.Request)
	})

	// r.Routes()

	r.Run() // listen and serve on 0.0.0.0:8080 (for windows "localhost:8080")

	// just run the execIntoPod function
	// gen3admin.ExecIntoPod()

}
