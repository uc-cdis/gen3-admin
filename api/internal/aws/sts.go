package aws

import (
	"context"
	"log"
	"net/http"
	"sort"
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
			// go-ini always reports a DEFAULT section, and ~/.aws/config also
			// holds non-profile sections such as sso-session and services.
			if s == ini.DefaultSection || strings.HasPrefix(s, "sso-session ") || strings.HasPrefix(s, "services ") {
				continue
			}
			name, _ := strings.CutPrefix(s, "profile ")
			profilesMap[name] = struct{}{}
		}
	}

	profiles := make([]string, 0, len(profilesMap))
	for p := range profilesMap {
		profiles = append(profiles, p)
	}
	sort.Strings(profiles)

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

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}
