package helm

import (
	"fmt"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/helmpath"
	"helm.sh/helm/v3/pkg/kube"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/repo"

	"github.com/rs/zerolog/log"
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
	CreatedAt  string `json:"createdAt"`
}

// InstallOptions contains all the configuration options for installing a Helm chart
type InstallOptions struct {
	ReleaseName     string
	Namespace       string
	RepoName        string
	RepoUrl         string
	ChartName       string
	Version         string
	Values          map[string]interface{}
	ValuesFiles     []string
	Wait            bool
	Timeout         time.Duration
	CreateNamespace bool
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
			CreatedAt:  rel.Info.LastDeployed.Format(time.RFC3339),
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

	// When actionConfig.Init is called it sets up the driver with the default namespace.
	// We need to change the namespace to honor the release namespace.
	// https://github.com/helm/helm/issues/9171
	actionConfig.KubeClient.(*kube.Client).Namespace = namespace

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
	// When actionConfig.Init is called it sets up the driver with the default namespace.
	// We need to change the namespace to honor the release namespace.
	// https://github.com/helm/helm/issues/9171
	actionConfig.KubeClient.(*kube.Client).Namespace = namespace

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
		log.Printf("Failed to list Helm repositories: %v", err)
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
		log.Printf("Repository not found: %s", repository)
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
		log.Error().Msgf("Failed to create chart repository: %v", err)
		return nil, fmt.Errorf("failed to create chart repository: %v", err)
	}

	// Download the index.yaml file from the repository
	indexFile, err := chartRepo.DownloadIndexFile()
	if err != nil {
		log.Error().Msgf("Failed to download index file: %v", err)
		return nil, fmt.Errorf("failed to download index file: %v", err)
	}

	// Load the index file to list charts
	index, err := repo.LoadIndexFile(indexFile)
	if err != nil {
		log.Error().Msgf("Failed to load index file: %v", err)
		return nil, fmt.Errorf("failed to load index file: %v", err)
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
// Takes repository details, chart information, and optional values as input.
func InstallHelmChart(opts InstallOptions) (*release.Release, error) {
	if err := opts.Validate(); err != nil {
		return nil, fmt.Errorf("invalid options: %w", err)
	}

	log.Warn().Msgf("Installing chart with options: %T", opts)

	settings := cli.New()
	settings.Debug = false

	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), opts.Namespace, "secrets", log.Printf); err != nil {
		return nil, fmt.Errorf("failed to init action config: %w", err)
	}

	if err := actionConfig.KubeClient.IsReachable(); err != nil {
		return nil, fmt.Errorf("failed to connect to kubernetes cluster: %w", err)
	}

	// Respect the release namespace properly
	actionConfig.KubeClient.(*kube.Client).Namespace = opts.Namespace

	if opts.RepoUrl == "" {
		repoURL, err := getRepositoryURL(opts.RepoName)
		if err != nil {
			return nil, err
		}
		opts.RepoUrl = repoURL
	}

	// Resolve chart version and download
	chartVersion, err := getChartVersion(settings, opts.RepoUrl, opts.ChartName, opts.Version)
	if err != nil {
		return nil, err
	}

	chartPath, err := downloadChart(settings, chartVersion)
	if err != nil {
		return nil, err
	}

	loadedChart, err := loader.Load(chartPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load chart: %w", err)
	}

	// Merge values
	values, err := mergeValues(opts.Values, opts.ValuesFiles)
	if err != nil {
		return nil, fmt.Errorf("failed to merge values: %w", err)
	}

	// Check if the release already exists
	history := action.NewHistory(actionConfig)
	history.Max = 1
	_, err = history.Run(opts.ReleaseName)
	releaseExists := err == nil

	if releaseExists {
		// Upgrade
		upgrade := action.NewUpgrade(actionConfig)
		upgrade.Namespace = opts.Namespace
		upgrade.Wait = opts.Wait
		upgrade.Timeout = opts.Timeout

		log.Debug().Msgf("Upgrading chart %s", opts.ChartName)
		return upgrade.Run(opts.ReleaseName, loadedChart, values)
	}

	// Install
	install := action.NewInstall(actionConfig)
	install.ReleaseName = opts.ReleaseName
	install.Namespace = opts.Namespace
	install.Wait = opts.Wait
	install.Timeout = opts.Timeout
	install.CreateNamespace = opts.CreateNamespace

	log.Debug().Msgf("Installing chart %s", opts.ChartName)
	return install.Run(loadedChart, values)
}
