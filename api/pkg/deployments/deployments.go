package deployments

import (
	"context"
	"strings"

	"github.com/uc-cdis/gen3-admin/pkg/config"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

type Deployment struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Containers    []Container       `json:"containers"`
	Replicas      int32             `json:"replicas"`
	ReadyReplicas int32             `json:"readyReplicas"`
	Ready         int32             `json:"ready"`
	Available     int32             `json:"available"`
	Unavailable   int32             `json:"unavailable"`
	Desired       int32             `json:"desired"`
	Created       metav1.Time       `json:"created"`
	Labels        map[string]string `json:"labels"`
	Volumes       []v1.Volume       `json:"volumes"`
}

// type Deployments struct {
// 	Deployments []Deployment `json:"deployments"`
// }

func GetDeployments(ctx context.Context) ([]Deployment, error) {
	clientset, namespace, err := config.K8sClient()
	if err != nil {
		return nil, err
	}

	// TODO: make ns configurable
	deployments, err := clientset.AppsV1().Deployments(*namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	depList := []Deployment{}
	for _, deployment := range deployments.Items {
		dep := Deployment{
			Name:          deployment.GetName(),
			Namespace:     deployment.GetNamespace(),
			Replicas:      *deployment.Spec.Replicas,
			ReadyReplicas: deployment.Status.ReadyReplicas,
			Ready:         0,
			Available:     deployment.Status.AvailableReplicas,
			Unavailable:   deployment.Status.UnavailableReplicas,
			Desired:       deployment.Status.Replicas,
			Created:       deployment.CreationTimestamp,
			Labels:        deployment.GetLabels(),
			Containers:    []Container{},
			Volumes:       deployment.Spec.Template.Spec.Volumes,
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

		if dep.ReadyReplicas == dep.Replicas {
			dep.Ready = 1
		}

		depList = append(depList, dep)
	}
	return depList, nil
}

func GetPodsForDeployment(ctx context.Context, deployment string) (*[]Pod, error) {
	clientset, namespace, err := config.K8sClient()
	if err != nil {
		return nil, err
	}

	// List pods
	podList, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		LabelSelector: "app=" + strings.Split(deployment, "-")[0],
		FieldSelector: "metadata.namespace=" + *namespace,
	})
	if err != nil {
		return nil, err
	}

	pods := []Pod{}
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
		pods = append(pods, p)
	}

	return &pods, nil
}
