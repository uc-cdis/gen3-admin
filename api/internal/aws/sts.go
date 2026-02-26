package aws

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/gin-gonic/gin"
	"gopkg.in/ini.v1"
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

// GetAwsProfiles reads AWS profiles from config and credentials files
func GetAwsProfiles() ([]string, error) {
	profilesMap := make(map[string]struct{})

	files := []string{
		config.DefaultSharedConfigFilename(),      // ~/.aws/config
		config.DefaultSharedCredentialsFilename(), // ~/.aws/credentials
	}

	for _, f := range files {
		iniFile, err := ini.Load(f)
		if err != nil {
			// skip missing/unreadable files
			continue
		}

		for _, s := range iniFile.SectionStrings() {
			name, _ := strings.CutPrefix(s, "profile ")
			profilesMap[name] = struct{}{}
		}
	}

	profiles := make([]string, 0, len(profilesMap))
	for p := range profilesMap {
		profiles = append(profiles, p)
	}

	return profiles, nil
}

// ListAWSProfilesHandler is the Gin endpoint
func ListAWSProfilesHandler(c *gin.Context) {
	profiles, err := GetAwsProfiles()
	if err != nil {
		log.Printf("Error reading AWS profiles: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read AWS profiles"})
		return
	}

	if len(profiles) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No AWS profiles found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

// SetAWSProfileHandler sets the AWS profile globally, but only if it exists
func SetAWSProfileHandler(c *gin.Context) {
	type request struct {
		Profile string `json:"profile"`
	}

	var req request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if req.Profile == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Profile cannot be empty"})
		return
	}

	// Get all available profiles
	profiles, err := GetAwsProfiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read AWS profiles"})
		return
	}

	// Check if the requested profile exists
	found := false
	for _, p := range profiles {
		if p == req.Profile {
			found = true
			break
		}
	}

	if !found {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Profile not found", "available_profiles": profiles})
		return
	}

	// Set the AWS_PROFILE environment variable globally
	if err := os.Setenv("AWS_PROFILE", req.Profile); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to set AWS profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "AWS profile set successfully", "profile": req.Profile})
}
