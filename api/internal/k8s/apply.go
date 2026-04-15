package k8s

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"github.com/rs/zerolog/log"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"

	"sigs.k8s.io/yaml"

	"github.com/uc-cdis/gen3-admin/pkg/config"
)

// ApplyYAMLToCluster parses a multi-document YAML string and applies each resource
// to the local Kubernetes cluster using the dynamic client.
func ApplyYAMLToCluster(yamlContent string, namespace string) error {
	clientset, _, err := config.K8sClient()
	if err != nil {
		return fmt.Errorf("failed to create k8s client: %w", err)
	}

	// Ensure namespace exists
	_, err = clientset.CoreV1().Namespaces().Create(
		context.TODO(),
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: namespace}},
		metav1.CreateOptions{},
	)
	if err != nil && !errors.IsAlreadyExists(err) {
		return fmt.Errorf("failed to create namespace %s: %w", namespace, err)
	}

	// Create dynamic client for generic resource operations
	kubeConfig, err := GetConfig()
	if err != nil {
		return fmt.Errorf("failed to get k8s config: %w", err)
	}
	dynamicClient, err := dynamic.NewForConfig(kubeConfig)
	if err != nil {
		return fmt.Errorf("failed to create dynamic client: %w", err)
	}

	// Split YAML documents and apply each one
	documents := strings.Split(yamlContent, "---")
	var applyErrors []string
	applied := 0

	for i, doc := range documents {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}

		// Decode YAML into unstructured object (no scheme needed)
		var obj unstructured.Unstructured
		if err := yaml.Unmarshal([]byte(doc), &obj); err != nil {
			log.Warn().Err(err).Msgf("Failed to decode YAML document %d, skipping", i+1)
			continue
		}

		if obj.GetKind() == "" || obj.GetAPIVersion() == "" {
			log.Warn().Msgf("Document %d missing kind or apiVersion, skipping", i+1)
			continue
		}

		// Set namespace for namespaced resources if not specified
		if obj.GetNamespace() == "" && isNamespaced(obj.GetKind()) {
			obj.SetNamespace(namespace)
		}

		name := obj.GetName()
		kind := obj.GetKind()
		gvk := obj.GroupVersionKind()

		log.Info().Msgf("Applying %s/%s (gvk=%s) in namespace %s", kind, name, gvk.String(), namespace)

		// Get resource interface from dynamic client
		gvr := gvk.GroupVersion().WithResource(resourceForKind(kind))
		var resInterface dynamic.ResourceInterface
		if isNamespaced(kind) {
			resInterface = dynamicClient.Resource(gvr).Namespace(obj.GetNamespace())
		} else {
			resInterface = dynamicClient.Resource(gvr)
		}

		_, err = resInterface.Create(context.TODO(), &obj, metav1.CreateOptions{})
		if errors.IsAlreadyExists(err) {
			log.Info().Msgf("%s %s already exists, updating", kind, name)
			existing, getErr := resInterface.Get(context.TODO(), name, metav1.GetOptions{})
			if getErr != nil {
				applyErrors = append(applyErrors, fmt.Sprintf("%s %s: get failed: %v", kind, name, getErr))
				continue
			}
			obj.SetResourceVersion(existing.GetResourceVersion())
			_, err = resInterface.Update(context.TODO(), &obj, metav1.UpdateOptions{})
		}
		if err != nil {
			log.Warn().Err(err).Msgf("Failed to apply %s/%s (continuing)", kind, name)
			applyErrors = append(applyErrors, fmt.Sprintf("%s %s: %v", kind, name, err))
			continue
		}
		applied++
	}

	log.Info().Int("applied", applied).Int("errors", len(applyErrors)).Msg("YAML apply complete")
	if len(applyErrors) > 0 {
		return fmt.Errorf("%d resource(s) applied successfully, %d error(s): %s", applied, len(applyErrors), strings.Join(applyErrors, "; "))
	}
	return nil
}

func isNamespaced(kind string) bool {
	switch kind {
	// Cluster-scoped
	case "Namespace", "ClusterRole", "ClusterRoleBinding",
		"CustomResourceDefinition", "PersistentVolume",
		"StorageClass", "PriorityClass":
		return false
	default:
		return true
	}
}

func resourceForKind(kind string) string {
	switch kind {
	case "Namespace":
		return "namespaces"
	case "ConfigMap":
		return "configmaps"
	case "Secret":
		return "secrets"
	case "ServiceAccount":
		return "serviceaccounts"
	case "Deployment":
		return "deployments"
	case "StatefulSet":
		return "statefulsets"
	case "DaemonSet":
		return "daemonsets"
	case "ReplicaSet":
		return "replicasets"
	case "Pod":
		return "pods"
	case "Service":
		return "services"
	case "Ingress":
		return "ingresses"
	case "Role":
		return "roles"
	case "RoleBinding":
		return "rolebindings"
	case "ClusterRole":
		return "clusterroles"
	case "ClusterRoleBinding":
		return "clusterrolebindings"
	case "CustomResourceDefinition":
		return "customresourcedefinitions"
	case "PersistentVolume":
		return "persistentvolumes"
	case "PersistentVolumeClaim":
		return "persistentvolumeclaims"
	case "StorageClass":
		return "storageclasses"
	case "NetworkPolicy":
		return "networkpolicies"
	case "PriorityClass":
		return "priorityclasses"
	default:
		return strings.ToLower(kind) + "s"
	}
}
