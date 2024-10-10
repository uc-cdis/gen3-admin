package helm

import (
	"fmt"
	"log"
	"strings"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/downloader"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/helmpath"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/repo"
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

type Repo struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type Chart struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	AppVersion  string `json:"appVersion"`
	ReleaseDate string `json:"releaseDate"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
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

func DeleteHelmRelease(releaseName string, namespace string) (*string, error) {

	settings := cli.New()

	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "", log.Printf); err != nil {
		return nil, err
	}

	// Set namespace

	// Create a new Get action
	client := action.NewUninstall(actionConfig)

	// Get the release
	release, err := client.Run(releaseName)
	if err != nil {
		return nil, fmt.Errorf("failed to get release: %v", err)
	}

	result := release.Info

	return &result, nil
}

// ListHelmRepos lists the Helm repositories from the repository file
func ListHelmRepos() ([]Repo, error) {
	// settings := cli.New()

	// Get the path to the repositories file (usually ~/.config/helm/repositories.yaml)
	repoFile := helmpath.ConfigPath("repositories.yaml")

	// Load the repository file
	file, err := repo.LoadFile(repoFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load repositories file: %w", err)
	}

	// Check if any repositories are defined
	if len(file.Repositories) == 0 {
		return nil, fmt.Errorf("no helm repos found")
	}

	// Extract repository names/URLs and log them
	var repos []Repo
	for _, r := range file.Repositories {
		log.Printf("Helm repo: %s (URL: %s)", r.Name, r.URL)
		repos = append(repos, Repo{Name: r.Name, URL: r.URL})
	}

	log.Printf("Helm repo count: %d", len(repos))

	return repos, nil
}

// listHelmCharts lists all charts in the provided Helm repository URL.
func ListHelmCharts(repository string) ([]Chart, error) {

	helmRepos, err := ListHelmRepos()
	if err != nil {
		log.Fatalf("Failed to list Helm repositories: %v", err)
		return nil, fmt.Errorf("failed to list Helm repositories: %v", err)
	}
	var repoURL string
	for _, repo := range helmRepos {
		if repo.Name == repository {
			repoURL = repo.URL
			break
		}
	}

	if repoURL == "" {
		log.Fatalf("Repository not found: %s", repository)
		return nil, fmt.Errorf("repository not found: %s", repository)
	}

	if !strings.HasPrefix(repoURL, "http") {
		repoURL = "https://" + repoURL
	}
	entry := &repo.Entry{
		URL: repoURL,
	}

	settings := cli.New()

	// Initialize chart repository
	chartRepo, err := repo.NewChartRepository(entry, getter.All(settings))
	if err != nil {
		log.Fatalf("Failed to create chart repository: %v", err)
	}

	// Download the index.yaml file from the repository
	indexFile, err := chartRepo.DownloadIndexFile()
	if err != nil {
		log.Fatalf("Failed to download index file: %v", err)
	}

	// Load the index file to list charts
	index, err := repo.LoadIndexFile(indexFile)
	if err != nil {
		log.Fatalf("Failed to load index file: %v", err)
	}

	var charts []Chart

	// Iterate over the index entries and list all charts
	for chartName, versions := range index.Entries {
		for _, version := range versions {
			charts = append(charts, Chart{
				Name:        chartName,
				Icon:        version.Icon,
				ReleaseDate: version.Created.Format("2006-01-02"),
				Version:     version.Version,
				AppVersion:  version.AppVersion,
				Description: version.Description,
			})
		}
	}
	return charts, nil
}

// InstallHelmChart installs or upgrades a Helm chart from a Helm repository.
// Takes a repository name, chart name, and an optional version as input.
func InstallHelmChart(releaseName, namespace, repoName, chartName, version string) (*release.Release, error) {

	// Fetch the repository URL based on the repo name using ListHelmRepos
	helmRepos, err := ListHelmRepos() // Assuming you have this function
	if err != nil {
		log.Fatalf("Failed to list Helm repositories: %v", err)
		return nil, fmt.Errorf("failed to list Helm repositories: %v", err)
	}

	// Find the repository URL for the given repository name
	var repoURL string
	for _, repo := range helmRepos {
		if repo.Name == repoName {
			repoURL = repo.URL
			break
		}
	}

	if repoURL == "" {
		log.Fatalf("Repository not found: %s", repoName)
		return nil, fmt.Errorf("repository not found: %s", repoName)
	}

	// Ensure the repository URL is properly formatted
	if !strings.HasPrefix(repoURL, "http") {
		repoURL = "https://" + repoURL
	}

	// Prepare the Helm action configuration
	settings := cli.New()
	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "secrets", log.Printf); err != nil {
		return nil, err
	}

	// Set up the chart repository entry
	entry := &repo.Entry{
		URL: repoURL,
	}

	// Initialize the chart repository using the provided repoURL
	chartRepo, err := repo.NewChartRepository(entry, getter.All(settings))
	if err != nil {
		log.Fatalf("Failed to create chart repository: %v", err)
	}

	// Download the index.yaml file from the repository to get chart information
	indexFile, err := chartRepo.DownloadIndexFile()
	if err != nil {
		log.Fatalf("Failed to download index file: %v", err)
	}

	// Load the index file
	index, err := repo.LoadIndexFile(indexFile)
	if err != nil {
		log.Fatalf("Failed to load index file: %v", err)
	}

	// Find the chart versions from the index
	chartVersions, found := index.Entries[chartName]
	if !found {
		return nil, fmt.Errorf("chart %s not found in repository %s", chartName, repoURL)
	}

	// If no version is provided, use the latest version
	if version == "" {
		version = chartVersions[0].Version
	}

	// Find the specific version of the chart
	var chartVersion *repo.ChartVersion
	for _, cv := range chartVersions {
		if cv.Version == version {
			chartVersion = cv
			break
		}
	}

	if chartVersion == nil {
		return nil, fmt.Errorf("chart %s version %s not found", chartName, version)
	}

	// Create a new Install action for installing the chart
	client := action.NewInstall(actionConfig)
	client.ReleaseName = releaseName
	client.Namespace = namespace

	// Download the chart from the repository
	chartDownloader := downloader.ChartDownloader{
		Out:     log.Writer(),
		Getters: getter.All(settings),
	}
	chartPath, _, err := chartDownloader.DownloadTo(chartVersion.URLs[0], version, "")
	if err != nil {
		return nil, fmt.Errorf("failed to download chart: %v", err)
	}

	// Load the downloaded chart
	loadedChart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart: %v", err)
	}

	// Install the chart
	release, err := client.Run(loadedChart, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to install or upgrade release: %v", err)
	}

	return release, nil
}
