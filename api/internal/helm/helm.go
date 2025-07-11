package helm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

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

type HelmRelease struct {
	Name      string
	Namespace string
	Chart     string
}

// =============================================================================
// RELEASE OPERATIONS: Pure CLI implementation
// =============================================================================

func ListAllHelmReleases() ([]Release, error) {
	cmd := exec.Command("helm", "list", "--all-namespaces", "--output", "json")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list releases: %w", err)
	}

	var rawReleases []map[string]interface{}
	if err := json.Unmarshal(output, &rawReleases); err != nil {
		return nil, fmt.Errorf("failed to parse helm output: %w", err)
	}

	releases := make([]Release, len(rawReleases))
	for i, raw := range rawReleases {
		releases[i] = Release{
			Name:       getStringField(raw, "name"),
			Namespace:  getStringField(raw, "namespace"),
			Revision:   getIntField(raw, "revision"),
			Status:     getStringField(raw, "status"),
			Chart:      getStringField(raw, "chart"),
			AppVersion: getStringField(raw, "app_version"),
			Helm:       "true",
			CreatedAt:  getStringField(raw, "updated"),
		}
	}

	log.Printf("Helm releases: %v", releases)
	return releases, nil
}

func ShowHelmValues(releaseName string, namespace string) (map[string]interface{}, error) {
	cmd := exec.Command("helm", "get", "values", releaseName, "-n", namespace, "--output", "json")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get release values: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("failed to parse values: %w", err)
	}

	return result, nil
}

func DeleteHelmRelease(releaseName string, namespace string) (*string, error) {
	cmd := exec.Command("helm", "uninstall", releaseName, "-n", namespace)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to delete release: %w", err)
	}

	result := string(output)
	return &result, nil
}

func InstallHelmChart(opts InstallOptions) (*HelmRelease, error) {
	if err := opts.Validate(); err != nil {
		return nil, fmt.Errorf("invalid options: %w", err)
	}

	log.Info().Msgf("Installing/upgrading Helm chart: %s/%s in namespace %s", opts.RepoName, opts.ChartName, opts.Namespace)

	// Get repo URL if not provided
	if opts.RepoUrl == "" {
		log.Debug().Msgf("Repository URL not provided, looking up URL for repo: %s", opts.RepoName)
		repoURL, err := getRepositoryURL(opts.RepoName)
		if err != nil {
			return nil, fmt.Errorf("failed to get repository URL for repo '%s': %w", opts.RepoName, err)
		}
		opts.RepoUrl = repoURL
		log.Debug().Msgf("Found repository URL: %s", opts.RepoUrl)
	}

	// Get repo name if not provided (when only URL is sent from frontend)
	if opts.RepoName == "" {
		log.Debug().Msgf("Repository name not provided, deriving from URL: %s", opts.RepoUrl)
		repoName, err := deriveRepoNameFromURL(opts.RepoUrl)
		if err != nil {
			return nil, fmt.Errorf("failed to derive repository name from URL '%s': %w", opts.RepoUrl, err)
		}
		opts.RepoName = repoName
		log.Debug().Msgf("Derived repository name: %s", opts.RepoName)
	}

	// Add repo if it doesn't exist
	if !repositoryExists(opts.RepoName) {
		log.Debug().Msgf("Repository '%s' not found, adding it", opts.RepoName)
		if err := AddHelmRepo(opts.RepoName, opts.RepoUrl); err != nil {
			return nil, fmt.Errorf("failed to add repository '%s': %w", opts.RepoName, err)
		}
		log.Info().Msgf("Successfully added repository: %s (%s)", opts.RepoName, opts.RepoUrl)

		// Update repo after adding
		if err := UpdateHelmRepos(); err != nil {
			log.Warn().Msgf("Failed to update repositories: %s", err)
		}
	}

	// Build helm command - using upgrade --install for idempotent operation
	args := []string{"upgrade", "--install"}

	// Add release name and chart
	args = append(args, opts.ReleaseName, fmt.Sprintf("%s/%s", opts.RepoName, opts.ChartName))
	args = append(args, "-n", opts.Namespace)

	// Add version if specified
	if opts.Version != "" {
		args = append(args, "--version", opts.Version)
		log.Debug().Msgf("Using chart version: %s", opts.Version)
	}

	// Add namespace creation flag
	if opts.CreateNamespace {
		args = append(args, "--create-namespace")
		log.Debug().Msgf("Will create namespace '%s' if it doesn't exist", opts.Namespace)
	}

	// Add wait flag
	if opts.Wait {
		args = append(args, "--wait")
		log.Debug().Msg("Will wait for resources to be ready")
	}

	// Add timeout
	if opts.Timeout > 0 {
		args = append(args, "--timeout", opts.Timeout.String())
		log.Debug().Msgf("Using timeout: %s", opts.Timeout.String())
	}

	// Handle values - always dump to YAML file for reliability
	var tempFile string
	if len(opts.Values) > 0 {
		log.Debug().Msgf("Creating temporary values file for %d values", len(opts.Values))

		var err error
		tempFile, err = createTempValuesFile(opts.Values)
		if err != nil {
			return nil, fmt.Errorf("failed to create temporary values file: %w", err)
		}
		defer func() {
			if err := os.Remove(tempFile); err != nil {
				log.Warn().Msgf("Failed to remove temporary values file '%s': %v", tempFile, err)
			}
		}()

		args = append(args, "-f", tempFile)
		log.Debug().Msgf("Using values file: %s", tempFile)
	}

	// Handle additional values files if provided
	for _, valuesFile := range opts.ValuesFiles {
		args = append(args, "-f", valuesFile)
		log.Debug().Msgf("Using additional values file: %s", valuesFile)
	}

	// Log the full command for debugging
	log.Debug().Msgf("Executing helm command: helm %s", strings.Join(args, " "))

	// Execute helm command with comprehensive error handling
	cmd := exec.Command("helm", args...)

	// Capture both stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Create detailed error message
		var errorMsg strings.Builder
		errorMsg.WriteString(fmt.Sprintf("helm command failed for release '%s' in namespace '%s'", opts.ReleaseName, opts.Namespace))

		if exitError, ok := err.(*exec.ExitError); ok {
			errorMsg.WriteString(fmt.Sprintf(" (exit code: %d)", exitError.ExitCode()))
		}

		if stderr.Len() > 0 {
			errorMsg.WriteString(fmt.Sprintf("\nSTDERR: %s", stderr.String()))
		}

		if stdout.Len() > 0 {
			errorMsg.WriteString(fmt.Sprintf("\nSTDOUT: %s", stdout.String()))
		}

		errorMsg.WriteString(fmt.Sprintf("\nCommand: helm %s", strings.Join(args, " ")))

		// Log the full error for debugging
		log.Error().Msgf("%s", errorMsg.String())

		return nil, fmt.Errorf("%s: %w", errorMsg.String(), err)
	}

	// Log successful installation/upgrade
	if stdout.Len() > 0 {
		log.Info().Msgf("Helm operation completed successfully:\n%s", stdout.String())
	}

	log.Info().Msgf("Successfully deployed Helm release '%s' (chart: %s/%s) in namespace '%s'",
		opts.ReleaseName, opts.RepoName, opts.ChartName, opts.Namespace)

	return &HelmRelease{
		Name:      opts.ReleaseName,
		Namespace: opts.Namespace,
		Chart:     opts.ChartName,
	}, nil
}

// =============================================================================
// REPOSITORY OPERATIONS: Pure CLI implementation
// =============================================================================

func ListHelmRepos() ([]Repo, error) {
	cmd := exec.Command("helm", "repo", "list", "--output", "json")
	output, err := cmd.Output()
	if err != nil {
		// If no repos configured, helm returns error
		if strings.Contains(err.Error(), "no repositories") {
			return nil, fmt.Errorf("no helm repos found")
		}
		return nil, fmt.Errorf("failed to list repos: %w", err)
	}

	var rawRepos []map[string]interface{}
	if err := json.Unmarshal(output, &rawRepos); err != nil {
		return nil, fmt.Errorf("failed to parse repo output: %w", err)
	}

	var repos []Repo
	for _, raw := range rawRepos {
		name := getStringField(raw, "name")
		url := getStringField(raw, "url")
		log.Printf("Helm repo: %s (URL: %s)", name, url)
		repos = append(repos, Repo{Name: name, URL: url})
	}

	log.Printf("Helm repo count: %d", len(repos))
	return repos, nil
}

func ListHelmCharts(repository string) ([]Chart, error) {
	// Update repo index first
	updateCmd := exec.Command("helm", "repo", "update", repository)
	if err := updateCmd.Run(); err != nil {
		log.Printf("Warning: failed to update repo %s: %v", repository, err)
	}

	// Search charts in the repository
	cmd := exec.Command("helm", "search", "repo", repository, "--output", "json")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to search charts: %w", err)
	}

	var rawCharts []map[string]interface{}
	if err := json.Unmarshal(output, &rawCharts); err != nil {
		return nil, fmt.Errorf("failed to parse chart list: %w", err)
	}

	var charts []Chart
	for _, raw := range rawCharts {
		name := getStringField(raw, "name")
		// Remove repo prefix from name
		if strings.Contains(name, "/") {
			parts := strings.Split(name, "/")
			if len(parts) > 1 {
				name = parts[1]
			}
		}

		charts = append(charts, Chart{
			Name:        name,
			Version:     getStringField(raw, "version"),
			AppVersion:  getStringField(raw, "app_version"),
			Description: getStringField(raw, "description"),
			// Note: CLI doesn't provide icon or release date easily
			Icon:        "",
			ReleaseDate: "",
		})
	}

	return charts, nil
}

// =============================================================================
// ADDITIONAL HELM OPERATIONS: Pure CLI
// =============================================================================
func deriveRepoNameFromURL(repoURL string) (string, error) {
	// Parse URL and extract a reasonable repo name
	// Examples:
	// https://charts.bitnami.com/bitnami -> "bitnami"
	// https://kubernetes.github.io/ingress-nginx -> "ingress-nginx"
	// https://helm.releases.hashicorp.com -> "hashicorp"

	if strings.HasSuffix(repoURL, "/") {
		repoURL = strings.TrimSuffix(repoURL, "/")
	}

	u, err := url.Parse(repoURL)
	if err != nil {
		return "", fmt.Errorf("invalid URL format: %w", err)
	}

	// Try to get name from path first (more specific)
	if u.Path != "" && u.Path != "/" {
		pathParts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(pathParts) > 0 && pathParts[len(pathParts)-1] != "" {
			return pathParts[len(pathParts)-1], nil
		}
	}

	// Fallback to hostname-based naming
	hostname := u.Host

	// Handle common patterns
	switch {
	case strings.Contains(hostname, "github.io"):
		// kubernetes.github.io -> kubernetes
		parts := strings.Split(hostname, ".")
		if len(parts) > 0 {
			return parts[0], nil
		}
	case strings.HasPrefix(hostname, "charts."):
		// charts.bitnami.com -> bitnami
		parts := strings.Split(hostname, ".")
		if len(parts) > 1 {
			return parts[1], nil
		}
	case strings.Contains(hostname, "releases."):
		// helm.releases.hashicorp.com -> hashicorp
		parts := strings.Split(hostname, ".")
		for i, part := range parts {
			if part == "releases" && i+1 < len(parts) {
				return parts[i+1], nil
			}
		}
	default:
		// Default: use first part of hostname
		parts := strings.Split(hostname, ".")
		if len(parts) > 0 {
			return parts[0], nil
		}
	}

	return "", fmt.Errorf("unable to derive repo name from URL: %s", repoURL)
}

func repositoryExists(repoName string) bool {
	cmd := exec.Command("helm", "repo", "list", "-o", "json")
	output, err := cmd.Output()
	if err != nil {
		log.Debug().Msgf("Failed to list helm repositories: %v", err)
		return false
	}

	// Handle empty repo list (helm returns null for empty list)
	if len(output) == 0 || string(output) == "null\n" {
		return false
	}

	var repos []map[string]interface{}
	if err := json.Unmarshal(output, &repos); err != nil {
		log.Debug().Msgf("Failed to parse helm repo list output: %v", err)
		return false
	}

	for _, repo := range repos {
		if name, ok := repo["name"].(string); ok && name == repoName {
			return true
		}
	}

	return false
}

func AddHelmRepo(name, url string) error {
	cmd := exec.Command("helm", "repo", "add", name, url)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to add repo %s: %w", name, err)
	}

	// Update repo index
	updateCmd := exec.Command("helm", "repo", "update", name)
	if err := updateCmd.Run(); err != nil {
		log.Printf("Warning: failed to update repo %s after adding: %v", name, err)
	}

	return nil
}

func RemoveHelmRepo(name string) error {
	cmd := exec.Command("helm", "repo", "remove", name)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to remove repo %s: %w", name, err)
	}
	return nil
}

func UpdateHelmRepos() error {
	cmd := exec.Command("helm", "repo", "update")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to update repos: %w", err)
	}
	return nil
}

func GetHelmReleaseHistory(releaseName, namespace string) ([]map[string]interface{}, error) {
	cmd := exec.Command("helm", "history", releaseName, "-n", namespace, "--output", "json")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get release history: %w", err)
	}

	var history []map[string]interface{}
	if err := json.Unmarshal(output, &history); err != nil {
		return nil, fmt.Errorf("failed to parse history: %w", err)
	}

	return history, nil
}

func RollbackHelmRelease(releaseName, namespace string, revision int) error {
	args := []string{"rollback", releaseName}
	if revision > 0 {
		args = append(args, fmt.Sprintf("%d", revision))
	}
	args = append(args, "-n", namespace)

	cmd := exec.Command("helm", args...)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to rollback release: %w", err)
	}

	return nil
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

func getRepositoryURL(repoName string) (string, error) {
	repos, err := ListHelmRepos()
	if err != nil {
		return "", fmt.Errorf("failed to list repositories: %w", err)
	}

	for _, repo := range repos {
		if repo.Name == repoName {
			return repo.URL, nil
		}
	}

	return "", fmt.Errorf("repository not found: %s", repoName)
}

// Check if helm CLI is available
func IsHelmAvailable() error {
	cmd := exec.Command("helm", "version", "--short")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("helm CLI not available: %w", err)
	}
	return nil
}

// Get helm version
func GetHelmVersion() (string, error) {
	cmd := exec.Command("helm", "version", "--short", "--client")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get helm version: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}
