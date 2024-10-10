package pods

import (
	"context"
	"fmt"

	"github.com/uc-cdis/gen3-admin/pkg/config"
	"github.com/uc-cdis/gen3-admin/pkg/deployments"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func ListPods(ctx context.Context) ([]deployments.Pod, error) {
	clientset, _, err := config.K8sClient()
	if err != nil {
		return nil, err
	}

	// List pods
	pods, err := clientset.CoreV1().Pods("").List(ctx, v1.ListOptions{})
	if err != nil {
		return nil, err
	}

	podList := []deployments.Pod{}
	for _, pod := range pods.Items {
		fmt.Printf("Pod name: %s\n", pod.GetName())
		podList = append(podList, deployments.Pod{
			Name:       pod.GetName(),
			Namespace:  pod.GetNamespace(),
			Containers: []deployments.Container{},
			Status:     string(pod.Status.Phase),
			Created:    pod.CreationTimestamp,
			Labels:     pod.GetLabels(),
		})
	}
	return podList, nil
}

// func getPodsForDeployment() {

// }
