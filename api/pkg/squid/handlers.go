package squid

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ListASGsHandler returns all the Squid Auto Scaling Groups
// Can be filtered by environment using the "env" query parameter
func ListASGsHandler(c *gin.Context) {
	// Get optional environment filter from query parameters
	envFilter := c.Query("env")

	asgs, err := GetSquidASGs(envFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, asgs)
}

// GetProxiesHandler returns information about all available squid proxies
func GetProxiesHandler(c *gin.Context) {
	// Get environment from path parameter or query parameter
	envName := c.Param("env")
	if envName == "" {
		envName = c.Query("env")
	}

	// Fall back to VPC_NAME env var if no parameter provided
	if envName == "" {
		envName = getEnv("VPC_NAME", "")
		if envName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Environment name required (via path parameter, query parameter, or VPC_NAME env var)"})
			return
		}
	}

	proxyPort, err := getProxyPort()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get all proxy information
	proxyInfo, err := GetProxiesInfo(envName, proxyPort)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, proxyInfo)
}

// SwapProxyHandler changes the active squid proxy
func SwapProxyHandler(c *gin.Context) {
	var requestBody struct {
		InstanceID string `json:"instance_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&requestBody); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format or missing instance_id"})
		return
	}

	// Get environment from path parameter or query parameter
	envName := c.Param("env")
	if envName == "" {
		envName = c.Query("env")
	}

	// Fall back to VPC_NAME env var if no parameter provided
	if envName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Environment name required (via path parameter, query parameter)"})
		return
	}

	// Perform the proxy swap
	err := SwapProxy(envName, requestBody.InstanceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get updated proxy information
	proxyPort, _ := getProxyPort()
	updatedInfo, err := GetProxiesInfo(envName, proxyPort)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Proxy swap successful, but unable to fetch updated information"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       "Proxy swap successful",
		"current_proxy": updatedInfo,
	})
}
