package config

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

// AWSConfig creates an AWS SDK v2 config from static credentials.
func AWSConfig(accessKeyID, secretAccessKey, region string) (aws.Config, error) {
	return aws.Config{
		Region: region,
		Credentials: credentials.NewStaticCredentialsProvider(
			accessKeyID,
			secretAccessKey,
			"",
		),
	}, nil
}

// NewS3Client creates an S3 client from an AWS config.
func NewS3Client(cfg aws.Config) *s3.Client {
	return s3.NewFromConfig(cfg)
}

func K8sClient() (*kubernetes.Clientset, *string, error) {
	var (
		kubeConfig *rest.Config
		err       error
	)

	// 1. Try in-cluster config (works when running inside Kubernetes)
	kubeConfig, err = rest.InClusterConfig()
	if err != nil {
		// 2. Fall back to kubeconfig (local dev)
		kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
		kubeConfig, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, nil, err
		}
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(kubeConfig)
	if err != nil {
		return nil, nil, err
	}

	// Determine namespace
	var namespace string

	// If running in-cluster, namespace is mounted via serviceaccount
	if nsBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
		namespace = strings.TrimSpace(string(nsBytes))
	} else {
		// Fall back to kubeconfig namespace
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		configOverrides := &clientcmd.ConfigOverrides{}
		kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			loadingRules,
			configOverrides,
		)

		namespace, _, err = kubeConfig.Namespace()
		if err != nil {
			return nil, nil, err
		}
	}

	return clientset, &namespace, nil
}
