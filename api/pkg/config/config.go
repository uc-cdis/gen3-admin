package config

import (
	"os"
	"path/filepath"
	"strings"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

func K8sClient() (*kubernetes.Clientset, *string, error) {
	var (
		config *rest.Config
		err    error
	)

	// 1. Try in-cluster config (works when running inside Kubernetes)
	config, err = rest.InClusterConfig()
	if err != nil {
		// 2. Fall back to kubeconfig (local dev)
		kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, nil, err
		}
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(config)
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
