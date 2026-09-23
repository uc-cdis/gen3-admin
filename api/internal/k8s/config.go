package k8s

import (
	"fmt"
	"os"
	"strings"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// GetConfig returns the in-cluster config when running in a pod, otherwise
// the kubeconfig named by KUBECONFIG, otherwise ~/.kube/config.
//
// It returns an error rather than panicking. It used to panic when KUBECONFIG
// was unset -- even with a valid ~/.kube/config -- or pointed at a missing
// file, and SetupReverseProxy calls it at startup, so the API could not boot
// on a machine with no cluster. That is exactly the machine the cloud
// bootstrap wizard is for, since it creates the first cluster.
func GetConfig() (*rest.Config, error) {
	if config, err := rest.InClusterConfig(); err == nil {
		return config, nil
	}

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	if kubeconfig := os.Getenv("KUBECONFIG"); kubeconfig != "" {
		loadingRules = &clientcmd.ClientConfigLoadingRules{
			Precedence: strings.Split(kubeconfig, string(os.PathListSeparator)),
		}
	}

	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		loadingRules, &clientcmd.ConfigOverrides{},
	).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("no Kubernetes cluster configured (not in-cluster, and no usable kubeconfig): %w", err)
	}
	return config, nil
}
