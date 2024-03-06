package deployments

import (
	"context"
	"path/filepath"
	"strings"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

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

type Pod struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace"`
	Containers []Container       `json:"containers"`
	Status     string            `json:"status"`
	Created    metav1.Time       `json:"created"`
	Labels     map[string]string `json:"labels"`
}

type Pods struct {
	Pods []Pod `json:"pods"`
}

type Deployment struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Containers  []Container       `json:"containers"`
	Replicas    int32             `json:"replicas"`
	Available   int32             `json:"available"`
	Unavailable int32             `json:"unavailable"`
	Desired     int32             `json:"desired"`
	Created     metav1.Time       `json:"created"`
	Labels      map[string]string `json:"labels"`
	Volumes     []v1.Volume       `json:"volumes"`
}

// type Deployments struct {
// 	Deployments []Deployment `json:"deployments"`
// }


func GetDeployments(ctx context.Context) ([]Deployment, error) {
	// / Load kubeconfig
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

	// List deployments
	// TODO: make ns configurable
	deployments, err := clientset.AppsV1().Deployments("default").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	depList := []Deployment{}
	for _, deployment := range deployments.Items {
		dep := Deployment{
			Name:        deployment.GetName(),
			Namespace:   deployment.GetNamespace(),
			Replicas:    *deployment.Spec.Replicas,
			Available:   deployment.Status.AvailableReplicas,
			Unavailable: deployment.Status.UnavailableReplicas,
			Desired:     deployment.Status.Replicas,
			Created:     deployment.CreationTimestamp,
			Labels:      deployment.GetLabels(),
			Containers:  []Container{},
			Volumes:     deployment.Spec.Template.Spec.Volumes,
		}
		for _, container := range deployment.Spec.Template.Spec.Containers {
			cont := Container{
				Name:            container.Name,
				Image:           container.Image,
				ImagePullPolicy: container.ImagePullPolicy,
				Resources:       container.Resources,
				VolumeMounts:    container.VolumeMounts,
				LivenessProbe:   container.LivenessProbe,
				ReadinessProbe:  container.ReadinessProbe,
			}
			dep.Containers = append(dep.Containers, cont)
		}
		depList = append(depList, dep)
	}
	return depList, nil
}

func GetPodsForDeployment(ctx context.Context, deployment string) (*Pods, error) {
	// / Load kubeconfig
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

	// List pods
	podList, err := clientset.CoreV1().Pods("").List(context.TODO(), metav1.ListOptions{
		LabelSelector: "app=" + strings.Split(deployment, "-")[0],
	})
	if err != nil {
		return nil, err
	}

	pods := Pods{}
	for _, pod := range podList.Items {
		p := Pod{
			Name:       pod.GetName(),
			Namespace:  pod.GetNamespace(),
			Containers: []Container{},
			Status:     string(pod.Status.Phase),
			Created:    pod.CreationTimestamp,
			Labels:     pod.GetLabels(),
		}
		for _, container := range pod.Spec.Containers {
			cont := Container{
				Name:            container.Name,
				Image:           container.Image,
				ImagePullPolicy: container.ImagePullPolicy,
				Resources:       container.Resources,
				VolumeMounts:    container.VolumeMounts,
				LivenessProbe:   container.LivenessProbe,
				ReadinessProbe:  container.ReadinessProbe,
			}
			p.Containers = append(p.Containers, cont)
		}
		pods.Pods = append(pods.Pods, p)
	}

	return &pods, nil
}
