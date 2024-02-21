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
