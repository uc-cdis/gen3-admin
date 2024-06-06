package cluster

import (
	"context"
	"fmt"

	"github.com/uc-cdis/gen3-admin/gen3admin/config"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Capacity struct {
	Capacity int64 `json:"capacity"`
	Used     int64 `json:"used"`
}

func GetClusterCapacity(ctx context.Context) (*Capacity, error) {
	client, _, err := config.K8sClient()
	if err != nil {
		return nil, err
	}

	capacity := Capacity{
		Capacity: 0,
	}
	nodes, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	for _, nodeName := range nodes.Items {

		node, err := client.CoreV1().Nodes().Get(ctx, nodeName.Name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}

		capacity.Capacity += node.Status.Allocatable.Pods().Value()

		// Get total number of pods running on nodes summed
		// Get pods running on the node
		podList, err := client.CoreV1().Pods(corev1.NamespaceAll).List(ctx, metav1.ListOptions{FieldSelector: fmt.Sprintf("spec.nodeName=%s", node.Name)})
		if err != nil {
			return nil, err
		}
		capacity.Used += int64(len(podList.Items))

	}
	return &capacity, nil
}
