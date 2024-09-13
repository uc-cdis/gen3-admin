package k8s

import (
	"net/http/httputil"
	"net/url"
	"path/filepath"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

// SetupReverseProxy creates a reverse proxy using Kubernetes API server URL and configured transport
func SetupReverseProxy() (*httputil.ReverseProxy, error) {
	var config *rest.Config
	var err error

	// Attempt to use in-cluster config
	config, err = rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig file
		kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			panic(err) // Handle error appropriately for your situation
		}
	}

	// Parse the API server URL from the config
	url, err := url.Parse(config.Host)
	if err != nil {
		return nil, err
	}

	// Create a reverse proxy
	proxy := httputil.NewSingleHostReverseProxy(url)

	// Set up the transport using the REST configuration
	transport, err := rest.TransportFor(config)
	if err != nil {
		return nil, err
	}

	// Assign the configured transport to the proxy
	proxy.Transport = transport

	return proxy, nil
}
