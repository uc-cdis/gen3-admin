package replicasets

import (
	"context"
	"path/filepath"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type ReplicaSet struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Labels    map[string]string `json:"labels"`
}

type ReplicaSets struct {
	ReplicaSets []ReplicaSet `json:"replicasets"`
}

func GetReplicaSets(ctx context.Context) ([]ReplicaSet, error) {
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

	// Get replica sets
	replicaSets, err := clientset.AppsV1().ReplicaSets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Create replica sets
	var replicaSetList []ReplicaSet
	for _, rs := range replicaSets.Items {
		replicaSetList = append(replicaSetList, ReplicaSet{
			Name:      rs.Name,
			Namespace: rs.Namespace,
			Labels:    rs.Labels,
		})
	}

	return replicaSetList, nil
}

func GetReplicaSet(ctx context.Context, replicaSetName, namespace string) (*ReplicaSet, error) {
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

	// Get replica set
	replicaSet, err := clientset.AppsV1().ReplicaSets(namespace).Get(ctx, replicaSetName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	return &ReplicaSet{
		Name:      replicaSet.Name,
		Namespace: replicaSet.Namespace,
		Labels:    replicaSet.Labels,
	}, nil
}
