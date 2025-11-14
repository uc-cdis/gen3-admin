package aws

import (
	"context"
	"log"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/gin-gonic/gin"
)

// GetCallerIdentity returns the AWS caller identity using STS
func GetCallerIdentity(c *gin.Context) {
	ctx := context.TODO()

	// Load AWS configuration
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("Error loading AWS configuration: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load AWS config"})
		return
	}

	// Create STS client
	stsClient := sts.NewFromConfig(cfg)

	// Call GetCallerIdentity
	result, err := stsClient.GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		log.Printf("Error calling GetCallerIdentity: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get caller identity"})
		return
	}

	// Respond with JSON
	c.JSON(http.StatusOK, result)
}
