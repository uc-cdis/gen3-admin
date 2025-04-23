package squid

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/autoscaling"
	"github.com/aws/aws-sdk-go/service/ec2"
	"github.com/aws/aws-sdk-go/service/route53"
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
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	// Get all ASGs
	svc := autoscaling.New(sess)

	// Get all ASGs
	result, err := svc.DescribeAutoScalingGroups(&autoscaling.DescribeAutoScalingGroupsInput{})
	if err != nil {
		return nil, err
	}

	var squidASGs []string
	for _, asg := range result.AutoScalingGroups {
		asgName := aws.StringValue(asg.AutoScalingGroupName)

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
	vpcID := aws.StringValue(vpc.VpcId)

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
			if route.DestinationCidrBlock != nil && aws.StringValue(route.DestinationCidrBlock) == "0.0.0.0/0" {
				currentGwInstanceID = aws.StringValue(route.InstanceId)
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

		// privIPs, err := getInstancesPrivIP([]string{instanceID})
		// if err != nil {
		// 	continue
		// }

		// pubIPs, err := getInstancesPubIP([]string{instanceID})
		// if err != nil {
		// 	continue
		// }

		// eniIDs, err := getInstancesENI([]string{instanceID})
		// if err != nil {
		// 	continue
		// }

		active := instanceID == currentGwInstanceID

		// var privIPs []string
		// for _, reservation := range reservations.Reservations {
		// 	for _, instance := range reservation.Instances {
		// 		privIPs = append(privIPs, aws.StringValue(instance.PrivateIpAddress))
		// 	}
		// }

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
					eniIDs = append(eniIDs, aws.StringValue(networkInterface.NetworkInterfaceId))
				}
				privIPs = append(privIPs, *instance.PrivateIpAddress)
				pubIPs = append(pubIPs, *instance.PublicIpAddress)
				ami = *instance.ImageId
			}
		}

		portStatus := "Closed"
		if checkPort(privIPs[0], proxyPort) {
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
		recordSets, err := getRecordSets(aws.StringValue(zone.Id))
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
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	// Get VPC ID
	vpc, err := getVPC(vpcName)
	if err != nil {
		return err
	}
	vpcID := aws.StringValue(vpc.VpcId)

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
	svc := ec2.New(sess)
	_, err = svc.ReplaceRoute(&ec2.ReplaceRouteInput{
		RouteTableId:         aws.String(eksPrivateRTID),
		DestinationCidrBlock: aws.String("0.0.0.0/0"),
		NetworkInterfaceId:   aws.String(enis[0]),
	})

	return err
}

// Helper functions
func getASG(name string) ([]*autoscaling.Group, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	svc := autoscaling.New(sess)

	var input *autoscaling.DescribeAutoScalingGroupsInput

	if name != "" {
		input = &autoscaling.DescribeAutoScalingGroupsInput{
			AutoScalingGroupNames: []*string{aws.String(name)},
		}
	} else {
		input = &autoscaling.DescribeAutoScalingGroupsInput{}
	}

	result, err := svc.DescribeAutoScalingGroups(input)
	if err != nil {
		return nil, err
	}

	return result.AutoScalingGroups, nil
}

func getHealthyInstancesID(asgGroups []*autoscaling.Group) []string {
	var idsList []string
	for _, asg := range asgGroups {
		for _, instance := range asg.Instances {
			if aws.StringValue(instance.HealthStatus) == "Healthy" {
				idsList = append(idsList, aws.StringValue(instance.InstanceId))
			}
		}
	}
	return idsList
}

func getInstancesInfo(idList []string) (*ec2.DescribeInstancesOutput, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	if len(idList) == 0 {
		return nil, fmt.Errorf("no instance IDs provided")
	}

	svc := ec2.New(sess)
	var instanceIDs []*string
	for _, id := range idList {
		instanceIDs = append(instanceIDs, aws.String(id))
	}

	input := &ec2.DescribeInstancesInput{
		InstanceIds: instanceIDs,
	}

	result, err := svc.DescribeInstances(input)
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
			privIPs = append(privIPs, aws.StringValue(instance.PrivateIpAddress))
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
				pubIPs = append(pubIPs, aws.StringValue(instance.PublicIpAddress))
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
				eniIDs = append(eniIDs, aws.StringValue(networkInterface.NetworkInterfaceId))
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

func getVPC(name string) (*ec2.Vpc, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	svc := ec2.New(sess)
	input := &ec2.DescribeVpcsInput{
		Filters: []*ec2.Filter{
			{
				Name:   aws.String("tag:Name"),
				Values: []*string{aws.String(name)},
			},
		},
	}

	result, err := svc.DescribeVpcs(input)
	if err != nil {
		return nil, err
	}

	if len(result.Vpcs) == 0 {
		return nil, fmt.Errorf("no VPC found with name %s", name)
	}

	return result.Vpcs[0], nil
}

func getRouteTable(vpcID, name string) (*ec2.DescribeRouteTablesOutput, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	svc := ec2.New(sess)
	input := &ec2.DescribeRouteTablesInput{
		Filters: []*ec2.Filter{
			{
				Name:   aws.String("tag:Name"),
				Values: []*string{aws.String(name)},
			},
			{
				Name:   aws.String("vpc-id"),
				Values: []*string{aws.String(vpcID)},
			},
		},
	}

	result, err := svc.DescribeRouteTables(input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getRouteTableID(routeTable *ec2.DescribeRouteTablesOutput) (string, error) {
	if len(routeTable.RouteTables) == 0 || len(routeTable.RouteTables[0].Associations) == 0 {
		return "", fmt.Errorf("no route table associations found")
	}

	return aws.StringValue(routeTable.RouteTables[0].Associations[0].RouteTableId), nil
}

func existDefaultGw(rtID string) (*ec2.DescribeRouteTablesOutput, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	svc := ec2.New(sess)
	input := &ec2.DescribeRouteTablesInput{
		Filters: []*ec2.Filter{
			{
				Name:   aws.String("route.destination-cidr-block"),
				Values: []*string{aws.String("0.0.0.0/0")},
			},
		},
		RouteTableIds: []*string{aws.String(rtID)},
	}

	result, err := svc.DescribeRouteTables(input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getHostedZone(comment string) (*route53.HostedZone, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	svc := route53.New(sess)
	result, err := svc.ListHostedZones(&route53.ListHostedZonesInput{})
	if err != nil {
		return nil, err
	}

	for _, zone := range result.HostedZones {
		if zone.Config.Comment != nil && aws.StringValue(zone.Config.Comment) == comment {
			return zone, nil
		}
	}

	return nil, fmt.Errorf("no hosted zone found with comment %s", comment)
}

func getRecordSets(zoneID string) (*route53.ListResourceRecordSetsOutput, error) {
	sess, err := session.NewSession(&aws.Config{
		Region: aws.String(getEnv("AWS_REGION", "us-east-1")),
	})
	if err != nil {
		panic(fmt.Sprintf("Failed to create AWS session: %v", err))
	}
	svc := route53.New(sess)
	input := &route53.ListResourceRecordSetsInput{
		HostedZoneId: aws.String(zoneID),
	}

	result, err := svc.ListResourceRecordSets(input)
	if err != nil {
		return nil, err
	}

	return result, nil
}

func getRecordSet(recordSets *route53.ListResourceRecordSetsOutput, name string) *route53.ResourceRecordSet {
	for _, recordSet := range recordSets.ResourceRecordSets {
		if aws.StringValue(recordSet.Name) == name {
			return recordSet
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
