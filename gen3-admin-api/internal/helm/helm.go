package helm

import (
	"fmt"
	"log"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

type Release struct {
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Revision   int    `json:"revision"`
	Status     string `json:"status"`
	Chart      string `json:"chart"`
	Icon       string `json:"icon"`
	AppVersion string `json:"appVersion"`
	Helm       string `json:"helm"`
}

func ListAllHelmReleases() ([]Release, error) {
	settings := cli.New()

	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), "", "", log.Printf); err != nil {
		return nil, err
	}

	client := action.NewList(actionConfig)
	client.AllNamespaces = true
	client.SetStateMask()

	results, err := client.Run()
	if err != nil {
		return nil, err
	}

	log.Printf("Helm releases: %v", results)

	releases := make([]Release, len(results))
	for i, rel := range results {
		releases[i] = Release{
			Name:       rel.Name,
			Namespace:  rel.Namespace,
			Revision:   rel.Version,
			Status:     rel.Info.Status.String(),
			Chart:      rel.Chart.Metadata.Name + "-" + rel.Chart.Metadata.Version,
			AppVersion: rel.Chart.Metadata.AppVersion,
			Icon:       rel.Chart.Metadata.Icon,
			Helm:       "true",
		}
	}

	return releases, nil
}

// show helm values
func ShowHelmValues(releaseName string, namespace string) (map[string]interface{}, error) {

	settings := cli.New()

	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), "", "", log.Printf); err != nil {
		return nil, err
	}

	// Create a new Get action
	client := action.NewGet(actionConfig)

	// Get the release
	release, err := client.Run(releaseName)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %v", err)
	}

	result := release.Config

	return result, nil
}
