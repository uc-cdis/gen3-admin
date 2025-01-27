package config

import (
	"path/filepath"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

func K8sClient() (*kubernetes.Clientset, *string, error) {
	// / Load kubeconfig
	kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "local.yaml")
	// clientcmd.BuildConfigFromKubeconfigGetter()
	// config, err := clientcmd.BuildConfigFromFlags("", os.Getenv("KUBECONFIG"))
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, nil, err
	}

	// Create clientset
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, nil, err
	}

	// Load namespace from kubeconfig
	// TODO: Make this cleaner?
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	configOverrides := &clientcmd.ConfigOverrides{}
	kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules,
		configOverrides)

	namespace, _, err := kubeConfig.Namespace()
	if err != nil {
		return nil, nil, err
	}

	return clientset, &namespace, nil
}
