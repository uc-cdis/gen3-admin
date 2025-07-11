package helm

import (
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"strings"

	"gopkg.in/yaml.v2"
)

// =============================================================================
// VALIDATION AND UTILITY FUNCTIONS
// =============================================================================

// Validate checks if the required options are provided
func (o *InstallOptions) Validate() error {
	if o.ReleaseName == "" {
		return errors.New("release name is required")
	}
	if o.Namespace == "" {
		return errors.New("namespace is required")
	}
	if o.RepoName == "" {
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

// =============================================================================
// VALUES HANDLING FUNCTIONS
// =============================================================================

// mergeValues merges values from different sources
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

// readValuesFile reads values from a YAML file
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

// mergeMaps recursively merges two maps
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

// createTempValuesFile creates a temporary YAML file with the given values
func createTempValuesFile(values map[string]interface{}) (string, error) {
	data, err := yaml.Marshal(values)
	if err != nil {
		return "", fmt.Errorf("failed to marshal values: %w", err)
	}

	tmpFile, err := ioutil.TempFile("", "helm-values-*.yaml")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tmpFile.Close()

	if _, err := tmpFile.Write(data); err != nil {
		return "", fmt.Errorf("failed to write temp file: %w", err)
	}

	return tmpFile.Name(), nil
}

// =============================================================================
// JSON PARSING UTILITIES
// =============================================================================

// getStringField safely extracts a string field from a map
func getStringField(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

// getIntField safely extracts an integer field from a map
func getIntField(m map[string]interface{}, key string) int {
	if val, ok := m[key]; ok {
		if num, ok := val.(float64); ok {
			return int(num)
		}
		if num, ok := val.(int); ok {
			return num
		}
	}
	return 0
}

// =============================================================================
// FILE SYSTEM UTILITIES
// =============================================================================

// fileExists checks if a file exists
func fileExists(filename string) bool {
	_, err := os.Stat(filename)
	return !os.IsNotExist(err)
}

// ensureDir creates a directory if it doesn't exist
func ensureDir(dirPath string) error {
	if _, err := os.Stat(dirPath); os.IsNotExist(err) {
		return os.MkdirAll(dirPath, 0755)
	}
	return nil
}

// =============================================================================
// STRING UTILITIES
// =============================================================================

// sanitizeString removes special characters that might cause issues in helm commands
func sanitizeString(s string) string {
	// Remove or replace characters that might cause issues
	s = strings.ReplaceAll(s, "'", "")
	s = strings.ReplaceAll(s, "\"", "")
	s = strings.ReplaceAll(s, "`", "")
	return strings.TrimSpace(s)
}

// formatChartReference formats a chart reference for helm commands
func formatChartReference(repoName, chartName string) string {
	if repoName == "" {
		return chartName
	}
	return fmt.Sprintf("%s/%s", repoName, chartName)
}

// parseChartName extracts chart name from a full chart reference
func parseChartName(chartRef string) string {
	if strings.Contains(chartRef, "/") {
		parts := strings.Split(chartRef, "/")
		return parts[len(parts)-1]
	}
	return chartRef
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

// validateHelmName checks if a name is valid for helm (release names, etc.)
func validateHelmName(name string) error {
	if name == "" {
		return errors.New("name cannot be empty")
	}

	// Helm names must be lowercase and can contain hyphens
	if strings.ToLower(name) != name {
		return errors.New("name must be lowercase")
	}

	// Check for invalid characters (basic validation)
	for _, char := range name {
		if !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-') {
			return fmt.Errorf("name contains invalid character: %c", char)
		}
	}

	return nil
}

// validateNamespace checks if a namespace name is valid
func validateNamespace(namespace string) error {
	if namespace == "" {
		return errors.New("namespace cannot be empty")
	}

	// Basic Kubernetes namespace validation
	if len(namespace) > 63 {
		return errors.New("namespace name too long (max 63 characters)")
	}

	return validateHelmName(namespace) // Same rules as helm names
}
