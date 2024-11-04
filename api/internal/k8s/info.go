package k8s

import (
	"context"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type Info struct {
	Provider string
	Version  string
}

func GetInfo() (*Info, error) {
	config, err := GetConfig()
	if err != nil {
		return nil, err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	serverVersion, err := clientset.Discovery().ServerVersion()
	if err != nil {
		return nil, err
	}

	provider, err := detectProvider(clientset)
	if err != nil {
		return nil, err
	}

	return &Info{
		Provider: provider,
		Version:  serverVersion.GitVersion,
	}, nil
}

func detectProvider(clientset *kubernetes.Clientset) (string, error) {
	nodes, err := clientset.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{Limit: 1})
	if err != nil || len(nodes.Items) == 0 {
		return "Unknown", err
	}

	node := nodes.Items[0]
	providerID := node.Spec.ProviderID

	providerChecks := []struct {
		name  string
		check func(node corev1.Node, providerID string) bool
	}{
		{"AWS", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "aws:///")
		}},
		{"GKE", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "gce://")
		}},
		{"Azure", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "azure://")
		}},
		{"DigitalOcean", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "digitalocean://")
		}},
		{"OpenStack", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "openstack://")
		}},
		{"Alibaba Cloud", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "alicloud://")
		}},
		{"Oracle Cloud", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "oci://")
		}},
		{"Minikube", func(node corev1.Node, providerID string) bool {
			return strings.Contains(node.Name, "minikube")
		}},
		{"KIND", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "kind://")
		}},
		{"K3s", func(node corev1.Node, providerID string) bool {
			return strings.Contains(node.Name, "k3s") || node.Labels["node.kubernetes.io/instance-type"] == "k3s"
		}},
		{"Rancher RKE", func(node corev1.Node, providerID string) bool {
			return node.Labels["rke.cattle.io/machine"] != ""
		}},
		{"VMware Tanzu", func(node corev1.Node, providerID string) bool {
			return node.Labels["run.tanzu.vmware.com"] != ""
		}},
		{"IBM Cloud", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "ibm://")
		}},
		{"Linode", func(node corev1.Node, providerID string) bool {
			return strings.HasPrefix(providerID, "linode://")
		}},
	}

	for _, check := range providerChecks {
		if check.check(node, providerID) {
			return check.name, nil
		}
	}

	// If no specific provider is detected, try to extract from ProviderID
	if providerID != "" {
		parts := strings.SplitN(providerID, ":", 2)
		if len(parts) > 0 {
			return strings.Title(parts[0]), nil
		}
	}

	return "Unknown", nil
}
