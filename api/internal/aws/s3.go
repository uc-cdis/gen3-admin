package aws

import (
	"context"
	"log"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
)

// S3Bucket represents a simplified S3 bucket response
type S3Bucket struct {
	Name         string `json:"name"`
	CreationDate string `json:"creation_date"`
	Region       string `json:"region"` // Added Region for Bucket
}

// listS3Buckets retrieves all S3 buckets
func ListS3Buckets(c *gin.Context) {
	ctx := context.TODO()

	// Load AWS configuration from the default credentials and region
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("Error loading AWS configuration: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load AWS config"})
		return
	}

	// Create S3 client
	s3Client := s3.NewFromConfig(cfg)

	// List S3 buckets
	result, err := s3Client.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		log.Printf("Error listing S3 buckets: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch S3 buckets"})
		return
	}

	// Respond with JSON
	c.JSON(http.StatusOK, result)
}
