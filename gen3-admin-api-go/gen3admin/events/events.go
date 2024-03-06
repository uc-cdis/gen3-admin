package events

import (
	"context"
	"path/filepath"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type Event struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Reason    string            `json:"reason"`
	Message   string            `json:"message"`
	Count     int32             `json:"count"`
	FirstSeen metav1.Time       `json:"firstSeen"`
	LastSeen  metav1.Time       `json:"lastSeen"`
	Labels    map[string]string `json:"labels"`
}

type Events struct {
	Events []Event `json:"events"`
}

func GetEvents(ctx context.Context) ([]Event, error) {
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

	// Get events
	events, err := clientset.CoreV1().Events("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Create events
	var eventList []Event
	for _, e := range events.Items {
		eventList = append(eventList, Event{
			Name:      e.Name,
			Namespace: e.Namespace,
			Reason:    e.Reason,
			Message:   e.Message,
			Count:     e.Count,
			FirstSeen: e.FirstTimestamp,
			LastSeen:  e.LastTimestamp,
			Labels:    e.Labels,
		})
	}

	return eventList, nil
}
