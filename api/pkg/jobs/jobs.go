package jobs

import (
	"context"
	"fmt"

	"github.com/uc-cdis/gen3-admin/pkg/config"
	v1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type CronJobOptions struct {
	Name     string   `json:"name"`
	Schedule string   `json:"schedule"`
	Suspend  bool     `json:"suspend"`
	Jobs     []v1.Job `json:"jobs"`
}

func GetJobOptions(ctx context.Context) ([]CronJobOptions, error) {
	clientset, namespace, err := config.K8sClient()
	if err != nil {
		return nil, err
	}
	// List jobs
	cronJobList, err := clientset.BatchV1().CronJobs(*namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	jobList, err := clientset.BatchV1().Jobs(*namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	// Loop over returned cronjobs
	cronjobOptions := []CronJobOptions{}
	for _, job := range cronJobList.Items {
		cronjob := CronJobOptions{
			Name:     job.GetName(),
			Schedule: job.Spec.Schedule,
			Suspend:  *job.Spec.Suspend,
		}
		for _, j := range jobList.Items {
			fmt.Println(j.ObjectMeta.Name)
			if j.ObjectMeta.OwnerReferences != nil {
				if j.ObjectMeta.OwnerReferences[0].Name == job.GetName() {
					cronjob.Jobs = append(cronjob.Jobs, j)
				}
			}
		}
		cronjobOptions = append(cronjobOptions, cronjob)
	}
	return cronjobOptions, nil
}

func GetJobInstances(ctx context.Context, jobName string) ([]v1.Job, error) {
	clientset, namespace, err := config.K8sClient()
	if err != nil {
		return nil, err
	}
	// List all jobs
	jobList, err := clientset.BatchV1().Jobs(*namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Jobs array
	jobRet := []v1.Job{}

	// Loop over returned cronjobs
	for _, job := range jobList.Items {
		fmt.Println(job.ObjectMeta.OwnerReferences)
		ownerRef := job.ObjectMeta.OwnerReferences
		if ownerRef != nil {
			if ownerRef[0].Name == jobName {
				jobRet = append(jobRet, job)
			}
		}
	}
	return jobRet, nil
}
