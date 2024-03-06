package secrets

import (
	"context"
	"path/filepath"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type Secret struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Data      map[string][]byte `json:"data"`
}

type Secrets struct {
	Secrets []Secret `json:"secrets"`
}

func GetSecrets(ctx context.Context) ([]Secret, error) {
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

	// Get secrets
	secrets, err := clientset.CoreV1().Secrets("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Create secrets
	var secretList []Secret
	for _, s := range secrets.Items {
		secretList = append(secretList, Secret{
			Name:      s.Name,
			Namespace: s.Namespace,
			Data:      s.Data,
		})
	}

	return secretList, nil
}

func GetSecret(ctx context.Context, secretName, namespace string) (*Secret, error) {
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

	// Get secret
	secret, err := clientset.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	return &Secret{
		Name:      secret.Name,
		Namespace: secret.Namespace,
		Data:      secret.Data,
	}, nil
}
