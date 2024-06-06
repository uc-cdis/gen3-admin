package cluster

import (
	"context"

	"github.com/uc-cdis/gen3-admin/gen3admin/config"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Event struct {
	Namespace string
	Message   string
	Timestamp metav1.Time
	Type      string
	Reason    string
	State     string
}

func GetClusterEvents(ctx context.Context) ([]Event, error) {
	client, _, err := config.K8sClient()
	if err != nil {
		return nil, err
	}

	// kubectl get events
	events, err := client.CoreV1().Events("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	eventsList := []Event{}

	// Print the events
	for _, event := range events.Items {
		eventsList = append(eventsList, Event{
			Message:   event.Message,
			Namespace: event.InvolvedObject.Namespace,
			Timestamp: event.LastTimestamp,
			Type:      event.Action,
			Reason:    event.Reason,
			State:     event.Type,
		})
	}
	return eventsList, nil
}
