package jobs

import (
	"context"
	"path/filepath"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type CronJobOptions struct {
	Name     string `json:"name"`
	Schedule string `json:"schedule"`
	Suspend  bool   `json:"suspend"`
}

func GetJobOptions(ctx context.Context) ([]CronJobOptions, error) {
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
	// List jobs
	jobList, err := clientset.BatchV1().CronJobs("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	// Loop over returned cronjobs
	cronjobList := []CronJobOptions{}
	for _, job := range jobList.Items {
		cronjob := CronJobOptions{
			Name:     job.GetName(),
			Schedule: job.Spec.Schedule,
			Suspend:  *job.Spec.Suspend,
		}
		cronjobList = append(cronjobList, cronjob)
	}
	return cronjobList, nil
}
