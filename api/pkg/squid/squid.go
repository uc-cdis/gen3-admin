package squid

import (
	"context"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/autoscaling"
	asgtypes "github.com/aws/aws-sdk-go-v2/service/autoscaling/types"

	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	"github.com/aws/aws-sdk-go-v2/service/route53/types"
)

// SquidInstance represents a single squid proxy instance
type SquidInstance struct {
	PrivIP      string            `json:"priv_ip"`
	PubIP       string            `json:"pub_ip"`
	Port3128    string            `json:"port_3128"`
	ENIID       string            `json:"eni_id"`
	Active      bool              `json:"active"`
	InstanceID  string            `json:"instance_id"`
	HealthState string            `json:"health_state"`
	Ami         string            `json:"ami_id"`
	Tags        map[string]string `json:"tags"`
}

// ProxyResponse contains all information about the squid proxies
type ProxyResponse struct {
	Instances       map[string]SquidInstance `json:"instances"`
	CloudProxyDNS   interface{}              `json:"cloud_proxy_dns"`
	CurrentActiveID string                   `json:"current_active_id"`
}

// GetSquidASGs returns all Squid Auto Scaling Groups
// If envFilter is provided, it will only return ASGs for that specific environment
func GetSquidASGs(envFilter string) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := autoscaling.NewFromConfig(cfg)

	// Get all ASGs
	result, err := svc.DescribeAutoScalingGroups(context.TODO(), &autoscaling.DescribeAutoScalingGroupsInput{})
	if err != nil {
		return nil, err
	}

	var squidASGs []string
	for _, asg := range result.AutoScalingGroups {
		asgName := aws.ToString(asg.AutoScalingGroupName)

		// First, check if this is a squid-auto-* ASG
		if strings.HasPrefix(asgName, "squid-auto-") {
			// If no filter is provided, add all squid-auto-* ASGs
			if envFilter == "" {
				squidASGs = append(squidASGs, asgName)
			} else {
				// If filter is provided, only add ASGs that match the filter
				if asgName == fmt.Sprintf("squid-auto-%s", envFilter) {
					squidASGs = append(squidASGs, asgName)
				}
			}
		}
	}

	return squidASGs, nil
}

// GetProxiesInfo returns information about all squid proxies
func GetProxiesInfo(vpcName string, proxyPort int) (*ProxyResponse, error) {
	// Get VPC ID
	vpc, err := getVPC(vpcName)
	if err != nil {
		return nil, err
	}
	vpcID := aws.ToString(vpc.VpcId)

	// Get route tables
	eksPrivateRT, err := getRouteTable(vpcID, "eks_private")
	if err != nil {
		return nil, err
	}

	eksPrivateRTID, err := getRouteTableID(eksPrivateRT)
	if err != nil {
		return nil, err
	}

	// Check current default gateway
	currentGw, err := existDefaultGw(eksPrivateRTID)
	if err != nil {
		return nil, err
	}

	// Get current gateway instance ID
	currentGwInstanceID := ""
	if len(currentGw.RouteTables) > 0 {
		for _, route := range currentGw.RouteTables[0].Routes {
			if route.DestinationCidrBlock != nil && aws.ToString(route.DestinationCidrBlock) == "0.0.0.0/0" {
				currentGwInstanceID = aws.ToString(route.InstanceId)
				break
			}
		}
	}

	// Get all healthy instances from squid ASG
	asgName := fmt.Sprintf("squid-auto-%s", vpcName)
	asgs, err := getASG(asgName)
	if err != nil {
		return nil, err
	}

	availableProxies := getHealthyInstancesID(asgs)

	// Get information for each proxy
	instances := make(map[string]SquidInstance)
	for _, instanceID := range availableProxies {

		instanceInfo, err := getInstancesInfo([]string{instanceID})
		if err != nil {
			continue
		}

		active := instanceID == currentGwInstanceID

		var privIPs []string
		var pubIPs []string
		var eniIDs []string
		var ami string
		tags := make(map[string]string)
		for _, reservation := range instanceInfo.Reservations {
			for _, instance := range reservation.Instances {
				for _, tag := range instance.Tags {
					tags[*tag.Key] = *tag.Value
				}
				for _, networkInterface := range instance.NetworkInterfaces {
					eniIDs = append(eniIDs, aws.ToString(networkInterface.NetworkInterfaceId))
				}
				privIPs = append(privIPs, *instance.PrivateIpAddress)
				if instance.PublicIpAddress != nil {
					pubIPs = append(pubIPs, *instance.PublicIpAddress)
				} else {
					pubIPs = append(pubIPs, "")
				}
				ami = *instance.ImageId
			}
		}

		portStatus := "Closed"
		if len(privIPs) > 0 && checkPort(privIPs[0], proxyPort) {
			portStatus = "Open"
		}

		instance := SquidInstance{
			PrivIP:      privIPs[0],
			PubIP:       pubIPs[0],
			Port3128:    portStatus,
			ENIID:       eniIDs[0],
			Active:      active,
			InstanceID:  instanceID,
			HealthState: "Healthy",
			Tags:        tags,
			Ami:         ami,
		}

		instances[instanceID] = instance
	}

	// Get cloud-proxy DNS record
	var cloudProxyDNS interface{} = "NONE"
	zone, err := getHostedZone(vpcName)
	if err == nil {
		recordSets, err := getRecordSets(aws.ToString(zone.Id))
		if err == nil {
			if recordSet := getRecordSet(recordSets, "cloud-proxy.internal.io"); recordSet != nil {
				cloudProxyDNS = recordSet
			}
		}
	}

	response := &ProxyResponse{
		Instances:       instances,
		CloudProxyDNS:   cloudProxyDNS,
		CurrentActiveID: currentGwInstanceID,
	}

	return response, nil
}

// SwapProxy changes the active squid proxy
func SwapProxy(vpcName, instanceID string) error {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %v", err)
	}

	// Get VPC ID
	vpc, err := getVPC(vpcName)
	if err != nil {
		return err
	}
	vpcID := aws.ToString(vpc.VpcId)

	// Get route tables
	eksPrivateRT, err := getRouteTable(vpcID, "eks_private")
	if err != nil {
		return err
	}

	eksPrivateRTID, err := getRouteTableID(eksPrivateRT)
	if err != nil {
		return err
	}

	// Get instance ENI
	enis, err := getInstancesENI([]string{instanceID})
	if err != nil {
		return err
	}

	if len(enis) == 0 {
		return fmt.Errorf("no ENI found for the specified instance")
	}

	// Update route table to use the new instance as default gateway
	svc := ec2.NewFromConfig(cfg)
	_, err = svc.ReplaceRoute(context.TODO(), &ec2.ReplaceRouteInput{
		RouteTableId:         aws.String(eksPrivateRTID),
		DestinationCidrBlock: aws.String("0.0.0.0/0"),
		NetworkInterfaceId:   aws.String(enis[0]),
	})

	return err
}

// Helper functions
func getASG(name string) ([]asgtypes.AutoScalingGroup, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := autoscaling.NewFromConfig(cfg)

	var input *autoscaling.DescribeAutoScalingGroupsInput

	if name != "" {
		input = &autoscaling.DescribeAutoScalingGroupsInput{
			AutoScalingGroupNames: []string{name},
		}
	} else {
		input = &autoscaling.DescribeAutoScalingGroupsInput{}
	}

	result, err := svc.DescribeAutoScalingGroups(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	return result.AutoScalingGroups, nil
}

func getHealthyInstancesID(asgGroups []asgtypes.AutoScalingGroup) []string {
	var idsList []string
	for _, asg := range asgGroups {
		for _, instance := range asg.Instances {
			if aws.ToString(instance.HealthStatus) == "Healthy" {
				idsList = append(idsList, aws.ToString(instance.InstanceId))
			}
		}
	}
	return idsList
}

func getInstancesInfo(idList []string) (*ec2.DescribeInstancesOutput, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	if len(idList) == 0 {
		return nil, fmt.Errorf("no instance IDs provided")
	}

	svc := ec2.NewFromConfig(cfg)

	input := &ec2.DescribeInstancesInput{
		InstanceIds: idList,
	}

	result, err := svc.DescribeInstances(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getInstancesPrivIP(instancesIDs []string) ([]string, error) {
	reservations, err := getInstancesInfo(instancesIDs)
	if err != nil {
		return nil, err
	}

	var privIPs []string
	for _, reservation := range reservations.Reservations {
		for _, instance := range reservation.Instances {
			privIPs = append(privIPs, aws.ToString(instance.PrivateIpAddress))
		}
	}

	return privIPs, nil
}

func getInstancesPubIP(instancesIDs []string) ([]string, error) {
	reservations, err := getInstancesInfo(instancesIDs)
	if err != nil {
		return nil, err
	}

	var pubIPs []string
	for _, reservation := range reservations.Reservations {
		for _, instance := range reservation.Instances {
			if instance.PublicIpAddress != nil {
				pubIPs = append(pubIPs, aws.ToString(instance.PublicIpAddress))
			} else {
				pubIPs = append(pubIPs, "")
			}
		}
	}

	return pubIPs, nil
}

func getInstancesENI(instancesIDs []string) ([]string, error) {
	reservations, err := getInstancesInfo(instancesIDs)
	if err != nil {
		return nil, err
	}

	var eniIDs []string
	for _, reservation := range reservations.Reservations {
		for _, instance := range reservation.Instances {
			for _, networkInterface := range instance.NetworkInterfaces {
				eniIDs = append(eniIDs, aws.ToString(networkInterface.NetworkInterfaceId))
			}
		}
	}

	return eniIDs, nil
}

func checkPort(addr string, port int) bool {
	timeout := time.Second * 5
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", addr, port), timeout)
	if err != nil {
		return false
	}
	defer conn.Close()
	return true
}

func getVPC(name string) (*ec2types.Vpc, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := ec2.NewFromConfig(cfg)
	input := &ec2.DescribeVpcsInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("tag:Name"),
				Values: []string{name},
			},
		},
	}

	result, err := svc.DescribeVpcs(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	if len(result.Vpcs) == 0 {
		return nil, fmt.Errorf("no VPC found with name %s", name)
	}

	return &result.Vpcs[0], nil
}

func getRouteTable(vpcID, name string) (*ec2.DescribeRouteTablesOutput, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := ec2.NewFromConfig(cfg)
	input := &ec2.DescribeRouteTablesInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("tag:Name"),
				Values: []string{name},
			},
			{
				Name:   aws.String("vpc-id"),
				Values: []string{vpcID},
			},
		},
	}

	result, err := svc.DescribeRouteTables(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getRouteTableID(routeTable *ec2.DescribeRouteTablesOutput) (string, error) {
	if len(routeTable.RouteTables) == 0 || len(routeTable.RouteTables[0].Associations) == 0 {
		return "", fmt.Errorf("no route table associations found")
	}

	return aws.ToString(routeTable.RouteTables[0].Associations[0].RouteTableId), nil
}

func existDefaultGw(rtID string) (*ec2.DescribeRouteTablesOutput, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := ec2.NewFromConfig(cfg)
	input := &ec2.DescribeRouteTablesInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("route.destination-cidr-block"),
				Values: []string{"0.0.0.0/0"},
			},
		},
		RouteTableIds: []string{rtID},
	}

	result, err := svc.DescribeRouteTables(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getHostedZone(comment string) (*types.HostedZone, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := route53.NewFromConfig(cfg)
	result, err := svc.ListHostedZones(context.TODO(), &route53.ListHostedZonesInput{})
	if err != nil {
		return nil, err
	}

	for _, zone := range result.HostedZones {
		if zone.Config.Comment != nil && aws.ToString(zone.Config.Comment) == comment {
			return &zone, nil
		}
	}

	return nil, fmt.Errorf("no hosted zone found with comment %s", comment)
}

func getRecordSets(zoneID string) (*route53.ListResourceRecordSetsOutput, error) {
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithRegion(getEnv("AWS_REGION", "us-east-1")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %v", err)
	}

	svc := route53.NewFromConfig(cfg)
	input := &route53.ListResourceRecordSetsInput{
		HostedZoneId: aws.String(zoneID),
	}

	result, err := svc.ListResourceRecordSets(context.TODO(), input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getRecordSet(recordSets *route53.ListResourceRecordSetsOutput, name string) *types.ResourceRecordSet {
	for _, recordSet := range recordSets.ResourceRecordSets {
		if aws.ToString(recordSet.Name) == name {
			return &recordSet
		}
	}
	return nil
}

func containsSubstring(s, substr string) bool {
	return len(s) >= len(substr) && s[:len(substr)] == substr
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func getProxyPort() (int, error) {
	proxyPortStr := getEnv("PROXY_PORT", "3128")
	proxyPort, err := strconv.Atoi(proxyPortStr)
	if err != nil {
		return 0, fmt.Errorf("invalid PROXY_PORT: %v", err)
	}
	return proxyPort, nil
}
