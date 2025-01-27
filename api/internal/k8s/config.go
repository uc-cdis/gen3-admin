package k8s

import (
	"os"
	"strings"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func GetConfig() (*rest.Config, error) {
	var config *rest.Config
	var err error

	// Attempt to use in-cluster config
	config, err = rest.InClusterConfig()
	if err != nil {
		// Check if KUBECONFIG env var is set, if so use the files from that
		kubeconfig := os.Getenv("KUBECONFIG")
		if kubeconfig != "" {
			// Split the KUBECONFIG env var into a list of files with ':' as the delimiter
			kubeconfigPaths := strings.Split(kubeconfig, ":")
			// log.Debug().Msgf("Using KUBECONFIG files: %v", kubeconfigPaths)

			// Set up the loading rules with the list of kubeconfig files
			loadingRules := &clientcmd.ClientConfigLoadingRules{
				Precedence: kubeconfigPaths,
			}

			// Create the client config
			configOverrides := &clientcmd.ConfigOverrides{}
			kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)

			// Get the merged config
			config, err = kubeConfig.ClientConfig()
			if err != nil {
				panic(err) // Handle error appropriately for your situation
			}
		} else {
			panic("Could not get Kubernetes config: neither in-cluster config nor KUBECONFIG is available")
		}
	}
	return config, nil
}
