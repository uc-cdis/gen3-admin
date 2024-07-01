// Setup MUX for API

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
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

// func AuthMiddleWare(logger *zap.SugaredLogger) gin.HandlerFunc {
// 	// Do some initialization logic here
// 	// Foo()
// 	return func(c *gin.Context) {
// 		logger.Warn("Something is checking auth for path: ", c.FullPath())
// 		logger.Warn(c.Request.Header)
// 		c.Next()
// 	}
// }

// func AuthMiddleware(logger *zap.SugaredLogger) gin.HandlerFunc {
// 	return func(c *gin.Context) {
// 		logger.Debug("Checking auth for path: ", c.FullPath())

// 		authHeader := c.GetHeader("Authorization")
// 		if authHeader == "" {
// 			c.JSON(401, gin.H{"error": "Authorization header is required"})
// 			c.Abort()
// 			return
// 		}

// 		bearerToken := strings.Split(authHeader, " ")
// 		fmt.Printf("Bearer token: %s", bearerToken)
// 		if len(bearerToken) != 2 || strings.ToLower(bearerToken[0]) != "bearer" {
// 			c.JSON(401, gin.H{"error": "Invalid Authorization header format"})
// 			c.Abort()
// 			return
// 		}

// 		tokenString := bearerToken[1]

// 		// Basic JWT validation
// 		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
// 			// TODO: Implement proper key retrieval and validation
// 			// This is a placeholder secret and should be replaced with proper key management
// 			return []byte("your-secret-key"), nil
// 		})

// 		if err != nil {
// 			logger.Error("Error parsing JWT: ", err)
// 			c.JSON(401, gin.H{"error": "Invalid token"})
// 			c.Abort()
// 			return
// 		}

// 		if !token.Valid {
// 			c.JSON(401, gin.H{"error": "Invalid token"})
// 			c.Abort()
// 			return
// 		}

// 		// TODO: Implement proper authentication and authorization checks
// 		// This should include verifying the token with your authN/Z services
// 		// and checking user permissions for the requested resource

// 		logger.Debug("Token is valid")
// 		c.Next()
// 	}
// }

func AuthMiddleware(logger *zap.SugaredLogger) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			c.Abort()
			return
		}

		bearerToken := strings.Split(authHeader, " ")
		if len(bearerToken) != 2 || strings.ToLower(bearerToken[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization header format"})
			c.Abort()
			return
		}

		// Extract claims for use in authz request
		tokenString := bearerToken[1]
		token, _ := jwt.Parse(tokenString, nil)
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid claims"})
			c.Abort()
			return
		}

		issuerURL, ok := claims["iss"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing issuer in token"})
			c.Abort()
			return
		}

		logger.Info(issuerURL)

		// Call AuthZ Service
		authzEndpoint := issuerURL + "/auth/mapping"
		reqBody, _ := json.Marshal(claims)
		authzResp, err := http.Post(authzEndpoint, "application/json", bytes.NewBuffer(reqBody))
		if err != nil {
			logger.Error("Error calling authZ service: ", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Authorization service error"})
			c.Abort()
			return
		}
		defer authzResp.Body.Close()

		logger.Info("User is authorized")
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
	r.Use(AuthMiddleware(sugar))
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
