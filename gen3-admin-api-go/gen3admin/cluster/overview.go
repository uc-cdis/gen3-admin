package cluster

import (
	"github.com/uc-cdis/gen3-admin/gen3admin/config"
	"k8s.io/apimachinery/pkg/version"
)

type ClusterVersion struct {
	Version string `json:"version"`
	K8sType string `json:"k8sType"`
}

func GetClusterVersion() (*version.Info, error) {
	clientset, err := config.GetClientset()
	if err != nil {
		return nil, err
	}

	version, err := clientset.Discovery().ServerVersion()
	if err != nil {
		return nil, err
	}

	clusterVersion := version
	return clusterVersion, nil
}

// Simplified version structure to hold just the major and minor version components
type SimpleVersion struct {
	Major string `json:"major"`
	Minor string `json:"minor"`
}

func GetClusterVersionSimple() (*SimpleVersion, error) {
	clientset, err := config.GetClientset()
	if err != nil {
		return nil, err
	}

	serverVersion, err := clientset.Discovery().ServerVersion()
	if err != nil {
		return nil, err
	}

	// Create a SimpleVersion struct instance to hold the major and minor version components
	simpleVersion := &SimpleVersion{
		Major: serverVersion.Major,
		Minor: serverVersion.Minor,
	}

	return simpleVersion, nil
}