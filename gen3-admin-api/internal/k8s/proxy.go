package k8s

import (
	"net/http/httputil"
	"net/url"

	"k8s.io/client-go/rest"
)

// SetupReverseProxy creates a reverse proxy using Kubernetes API server URL and configured transport
func SetupReverseProxy() (*httputil.ReverseProxy, error) {
	config, err := GetConfig()
	if err != nil {
		return nil, err
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
