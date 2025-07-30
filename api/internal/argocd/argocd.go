package argocd

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/uc-cdis/gen3-admin/internal/k8s"
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
	HealthStatus   string `json:"status"`
	Chart          string `json:"chart"`
	Project        string `json:"project"`
	SyncStatus     string `json:"syncStatus"`
	OperationPhase string `json:"operationPhase"`
	Revision       string `json:"revision"`
	RepoURL        string `json:"repoURL"`
	TargetRevision string `json:"targetRevision"`
	Environment    string `json:"environment"`
	CreatedAt      string `json:"createdAt"`
}

type Release struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Revision   int    `json:"revision"`
	Status     string `json:"status"`
	Chart      string `json:"chart"`
	Icon       string `json:"icon"`
	AppVersion string `json:"appVersion"`
	Helm       string `json:"helm"`
	CreatedAt  string `json:"createdAt"`
}

// ListArgoCDApplications retrieves all ArgoCD applications with detailed information
func ListArgoCDApplications(ctx context.Context) ([]ArgoCDApplication, error) {
	config, err := k8s.GetConfig()
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

	sources, found, err := unstructured.NestedSlice(spec, "sources")
	var firstSource map[string]interface{}

	if err != nil || !found || len(sources) == 0 {
		log.Warn().Interface("sources", sources).Msg("Sources not found or empty")
		// Default to an empty map if needed, or return if this is critical
		firstSource = map[string]interface{}{}
	} else {
		firstSourceRaw := sources[0]
		var ok bool
		firstSource, ok = firstSourceRaw.(map[string]interface{})
		if !ok {
			log.Warn().Interface("firstSourceRaw", firstSourceRaw).Msg("First source is not a map")
			firstSource = map[string]interface{}{}
		}
	}

	app.TargetRevision, _, _ = unstructured.NestedString(firstSource, "targetRevision")
	app.Chart, found, _ = unstructured.NestedString(firstSource, "chart")
	if !found {
		app.Chart, _, _ = unstructured.NestedString(firstSource, "path")
	}

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

	// Get destination namespace instead of ArgoCD resource namespace
	destinationNamespace, _, _ := unstructured.NestedString(spec, "destination", "namespace")
	if destinationNamespace != "" {
		app.Namespace = destinationNamespace
	} else {
		// Fallback to ArgoCD resource namespace if destination namespace is not found
		app.Namespace = item.GetNamespace()
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
