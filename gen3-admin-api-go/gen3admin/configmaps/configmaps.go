// setup similar to deployments.go

package configmaps

import (
	"context"
	"path/filepath"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type ConfigMap struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Data      map[string]string `json:"data"`
}

type ConfigMaps struct {
	ConfigMaps []ConfigMap `json:"configmaps"`
}

func GetConfigMaps(ctx context.Context) ([]ConfigMap, error) {
	// Load kubeconfig
	kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, err
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	// Get configmaps
	configmaps, err := clientset.CoreV1().ConfigMaps("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Create configmaps
	var configMaps []ConfigMap
	for _, cm := range configmaps.Items {
		configMaps = append(configMaps, ConfigMap{
			Name:      cm.Name,
			Namespace: cm.Namespace,
			Data:      cm.Data,
		})
	}

	return configMaps, nil
}
