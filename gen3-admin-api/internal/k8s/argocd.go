package k8s

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// ArgoCDApplication represents an ArgoCD application with detailed information
type ArgoCDApplication struct {
	Name           string `json:"name"`
	Namespace      string `json:"namespace"`
	Project        string `json:"project"`
	SyncStatus     string `json:"syncStatus"`
	HealthStatus   string `json:"healthStatus"`
	OperationPhase string `json:"operationPhase"`
	Revision       string `json:"revision"`
	RepoURL        string `json:"repoURL"`
	TargetRevision string `json:"targetRevision"`
	Environment    string `json:"environment"`
	CreatedAt      string `json:"createdAt"`
}

// ListArgoCDApplications retrieves all ArgoCD applications with detailed information
func ListArgoCDApplications(ctx context.Context) ([]ArgoCDApplication, error) {
	config, err := GetConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get in-cluster config: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	apiextensionsClientset, err := apiextensionsclientset.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create apiextensions clientset: %w", err)
	}

	applicationGVR := schema.GroupVersionResource{
		Group:    "argoproj.io",
		Version:  "v1alpha1",
		Resource: "applications",
	}

	// Check if the ArgoCD Application CRD exists
	_, err = apiextensionsClientset.ApiextensionsV1().CustomResourceDefinitions().Get(ctx, "applications.argoproj.io", metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			log.Info().Msg("ArgoCD Application CRD not found, returning empty list")
			return []ArgoCDApplication{}, nil
		}
		return nil, fmt.Errorf("failed to check for ArgoCD Application CRD: %w", err)
	}

	// List all ArgoCD applications across all namespaces
	list, err := dynamicClient.Resource(applicationGVR).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list ArgoCD applications: %w", err)
	}

	var applications []ArgoCDApplication
	for _, item := range list.Items {
		app, err := extractApplicationInfo(&item)
		if err != nil {
			log.Warn().Err(err).Str("name", item.GetName()).Msg("Failed to extract application info")
			continue
		}
		applications = append(applications, app)
	}

	log.Info().Msgf("Found %d ArgoCD applications", len(applications))
	return applications, nil
}

func extractApplicationInfo(item *unstructured.Unstructured) (ArgoCDApplication, error) {
	app := ArgoCDApplication{
		Name:      item.GetName(),
		Namespace: item.GetNamespace(),
		CreatedAt: item.GetCreationTimestamp().String(),
	}

	spec, found, err := unstructured.NestedMap(item.Object, "spec")
	if err != nil || !found {
		return app, fmt.Errorf("error retrieving spec: %w", err)
	}

	app.Project, _, _ = unstructured.NestedString(spec, "project")
	app.RepoURL, _, _ = unstructured.NestedString(spec, "source", "repoURL")
	app.TargetRevision, _, _ = unstructured.NestedString(spec, "source", "targetRevision")

	status, found, err := unstructured.NestedMap(item.Object, "status")
	if err != nil || !found {
		return app, fmt.Errorf("error retrieving status: %w", err)
	}

	app.Revision, _, _ = unstructured.NestedString(status, "sync", "revision")

	if syncStatus, ok := status["sync"].(map[string]interface{}); ok {
		app.SyncStatus, _ = syncStatus["status"].(string)
	}

	if healthStatus, ok := status["health"].(map[string]interface{}); ok {
		app.HealthStatus, _ = healthStatus["status"].(string)
	}

	if operationState, ok := status["operationState"].(map[string]interface{}); ok {
		app.OperationPhase, _ = operationState["phase"].(string)
	}

	// Try to determine environment from various possible locations
	app.Environment = determineEnvironment(spec, item.GetLabels(), item.GetAnnotations())

	return app, nil
}

func determineEnvironment(spec map[string]interface{}, labels map[string]string, annotations map[string]string) string {
	// Check in spec.destination.namespace
	if dest, ok := spec["destination"].(map[string]interface{}); ok {
		if env, ok := dest["namespace"].(string); ok {
			return env
		}
	}

	// Check in labels
	if env, ok := labels["environment"]; ok {
		return env
	}

	// Check in annotations
	if env, ok := annotations["environment"]; ok {
		return env
	}

	// If not found, return "unknown"
	return "unknown"
}
