package deployments

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/uc-cdis/gen3-admin/gen3admin/replicasets"
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
	Name          string                 `json:"name"`
	Namespace     string                 `json:"namespace"`
	Containers    []Container            `json:"containers"`
	Replicas      int32                  `json:"replicas"`
	ReadyReplicas int32                  `json:"readyReplicas"`
	Ready         int32                  `json:"ready"`
	Available     int32                  `json:"available"`
	Unavailable   int32                  `json:"unavailable"`
	Desired       int32                  `json:"desired"`
	Created       metav1.Time            `json:"created"`
	Labels        map[string]string      `json:"labels"`
	Volumes       []v1.Volume            `json:"volumes"`
	Replicasets   replicasets.ReplicaSet `json:"replicaset"`
}

// type Deployments struct {
// 	Deployments []Deployment `json:"deployments"`
// }

func GetDeployments(ctx context.Context, namespace string) ([]Deployment, error) {
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
	deployments, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	replicaset := replicasets.ReplicaSet{}

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
			Replicasets:   replicaset,
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

		// Get replicaset for deployment
		replicaset, err := GetReplicasetForDeployment(ctx, deployment.GetName())
		if err != nil {
			return nil, err
		}
		if replicaset != nil {
			dep.Replicasets = *replicaset
		}

		depList = append(depList, dep)
	}
	return depList, nil
}

func GetPodsForDeployment(ctx context.Context, deployment string, namespace string) ([]Pod, error) {
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

	return pods, nil
}

// get replicaset for deployment based on deployment.kubernetes.io/revision:
func GetReplicasetForDeployment(ctx context.Context, deployment string) (*replicasets.ReplicaSet, error) {
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

	// List replicaset
	replicaSets, err := clientset.AppsV1().ReplicaSets("").List(ctx, metav1.ListOptions{
		LabelSelector: "app=" + strings.Split(deployment, "-")[0],
	})
	if err != nil {
		return nil, err
	}

	for _, rs := range replicaSets.Items {
		if rs.Labels["app"] == strings.Split(deployment, "-")[0] {
			return &replicasets.ReplicaSet{
				Name:      rs.Name,
				Namespace: rs.Namespace,
				Labels:    rs.Labels,
			}, nil
		}
	}

	return nil, nil
}
