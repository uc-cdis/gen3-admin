package daemonsets

import (
	"context"
	"path/filepath"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type Daemonset struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace"`
	Containers []Container       `json:"containers"`
	Labels     map[string]string `json:"labels"`
}

type Daemonsets struct {
	Daemonsets []Daemonset `json:"daemonsets"`
}

type Container struct {
	Name            string                  `json:"name"`
	Image           string                  `json:"image"`
	ImagePullPolicy v1.PullPolicy           `json:"imagePullPolicy"`
	Resources       v1.ResourceRequirements `json:"resources"`
	State           v1.ContainerState       `json:"state"`
	VolumeMounts    []v1.VolumeMount        `json:"volumeMounts"`
	LivenessProbe   *v1.Probe               `json:"livenessProbe"`
	ReadinessProbe  *v1.Probe               `json:"readinessProbe"`
}

func GetDaemonsets(ctx context.Context) ([]Daemonset, error) {
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

	// Get daemonsets
	daemonsets, err := clientset.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Create daemonsets
	var daemonSets []Daemonset
	for _, ds := range daemonsets.Items {
		daemonSets = append(daemonSets, Daemonset{
			Name:       ds.Name,
			Namespace:  ds.Namespace,
			Containers: getContainers(ds.Spec.Template.Spec.Containers),
			Labels:     ds.Labels,
		})
	}

	return daemonSets, nil
}

func getContainers(containers []v1.Container) []Container {
	var cs []Container
	for _, c := range containers {
		cs = append(cs, Container{
			Name:            c.Name,
			Image:           c.Image,
			ImagePullPolicy: c.ImagePullPolicy,
			Resources:       c.Resources,
			VolumeMounts:    c.VolumeMounts,
			LivenessProbe:   c.LivenessProbe,
			ReadinessProbe:  c.ReadinessProbe,
		})
	}
	return cs
}
