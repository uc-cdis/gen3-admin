package aws

import (
	"context"
	"log"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/gin-gonic/gin"
)

// EC2Instance represents a simplified EC2 instance response
type EC2Instance struct {
	InstanceID     string   `json:"instance_id"`
	State          string   `json:"state"`
	Type           string   `json:"instance_type"`
	Region         string   `json:"region"`
	Tags           []Tag    `json:"tags"`
	PublicIP       string   `json:"public_ip"`
	PrivateIP      string   `json:"private_ip"`
	LaunchTime     string   `json:"launch_time"`
	ImageID        string   `json:"image_id"`
	KeyName        string   `json:"key_name"`
	VPCID          string   `json:"vpc_id"`
	SubnetID       string   `json:"subnet_id"`
	SecurityGroups []string `json:"security_groups"`
	IAMRole        string   `json:"iam_role"`
	Monitoring     string   `json:"monitoring"`
	Platform       string   `json:"platform"`
}

// Tag represents a tag associated with an EC2 instance
type Tag struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// listEC2Instances retrieves all EC2 instances
func ListEC2Instances(c *gin.Context) {
	ctx := context.TODO()

	// Load AWS configuration from the default credentials and region
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("Error loading AWS configuration: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load AWS config"})
		return
	}

	// Create EC2 client
	ec2Client := ec2.NewFromConfig(cfg)

	// Describe EC2 instances
	result, err := ec2Client.DescribeInstances(ctx, &ec2.DescribeInstancesInput{})
	if err != nil {
		log.Printf("Error describing EC2 instances: %v", err)

		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// // Parse instances
	// var instances []EC2Instance
	// for _, reservation := range result.Reservations {
	// 	//
	// 	for _, instance := range reservation.Instances {
	// 		instances = append(instances, EC2Instance{
	// 			InstanceID: *instance.InstanceId,
	// 			State:      string(instance.State.Name),
	// 			Type:       string(instance.InstanceType),
	// 			Region:     cfg.Region,
	// 		})
	// 	}
	// }

	// Respond with JSON
	c.JSON(http.StatusOK, result.Reservations)
}
