package helm

import (
	"errors"
	"fmt"
	"io/ioutil"
	"log"
	"strings"

	"gopkg.in/yaml.v2"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/downloader"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/repo"
)

// Validate checks if the required options are provided
func (o *InstallOptions) Validate() error {
	if o.ReleaseName == "" {
		return errors.New("release name is required")
	}
	if o.Namespace == "" {
		return errors.New("namespace is required")
	}
	if o.RepoName == "" {
		// check if repoUrl is provided
		if o.RepoUrl == "" {
			return errors.New("repository name or url is required")
		}
		return nil
	}
	if o.ChartName == "" {
		return errors.New("chart name is required")
	}
	return nil
}

// Helper function to get chart version information
func getChartVersion(settings *cli.EnvSettings, repoURL, chartName, version string) (*repo.ChartVersion, error) {
	entry := &repo.Entry{URL: repoURL}
	chartRepo, err := repo.NewChartRepository(entry, getter.All(settings))
	if err != nil {
		return nil, fmt.Errorf("failed to create chart repository: %w", err)
	}

	indexFile, err := chartRepo.DownloadIndexFile()
	if err != nil {
		return nil, fmt.Errorf("failed to download index file: %w", err)
	}

	index, err := repo.LoadIndexFile(indexFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load index file: %w", err)
	}

	chartVersions, found := index.Entries[chartName]
	if !found {
		return nil, fmt.Errorf("chart %s not found in repository %s", chartName, repoURL)
	}

	if version == "" {
		return chartVersions[0], nil
	}

	for _, cv := range chartVersions {
		if cv.Version == version {
			return cv, nil
		}
	}

	return nil, fmt.Errorf("version %s not found for chart %s", version, chartName)
}

// Helper function to download chart
func downloadChart(settings *cli.EnvSettings, chartVersion *repo.ChartVersion) (string, error) {
	chartDownloader := downloader.ChartDownloader{
		Out:     log.Writer(),
		Getters: getter.All(settings),
	}

	chartPath, _, err := chartDownloader.DownloadTo(chartVersion.URLs[0], chartVersion.Version, "")
	if err != nil {
		return "", fmt.Errorf("failed to download chart: %w", err)
	}

	return chartPath, nil
}

// Helper function to merge values from different sources
func mergeValues(values map[string]interface{}, valueFiles []string) (map[string]interface{}, error) {
	base := map[string]interface{}{}

	// First merge all values files
	for _, filePath := range valueFiles {
		currentValues, err := readValuesFile(filePath)
		if err != nil {
			return nil, err
		}
		base = mergeMaps(base, currentValues)
	}

	// Then merge the direct values (they take precedence)
	return mergeMaps(base, values), nil
}

// Helper function to read values from a file
func readValuesFile(filePath string) (map[string]interface{}, error) {
	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read values file: %w", err)
	}

	values := map[string]interface{}{}
	err = yaml.Unmarshal(data, &values)
	if err != nil {
		return nil, fmt.Errorf("failed to parse values file: %w", err)
	}

	return values, nil
}

// Helper function to merge maps recursively
func mergeMaps(base, override map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{}, len(base))
	for k, v := range base {
		result[k] = v
	}
	for k, v := range override {
		if baseVal, ok := result[k]; ok {
			if baseMap, ok := baseVal.(map[string]interface{}); ok {
				if overrideMap, ok := v.(map[string]interface{}); ok {
					result[k] = mergeMaps(baseMap, overrideMap)
					continue
				}
			}
		}
		result[k] = v
	}
	return result
}

// Helper function to get repository URL
func getRepositoryURL(repoName string) (string, error) {
	helmRepos, err := ListHelmRepos()
	if err != nil {
		return "", fmt.Errorf("failed to list Helm repositories: %w", err)
	}

	for _, repo := range helmRepos {
		if repo.Name == repoName {
			if !strings.HasPrefix(repo.URL, "http") {
				return "https://" + repo.URL, nil
			}
			return repo.URL, nil
		}
	}

	return "", fmt.Errorf("repository not found: %s", repoName)
}
