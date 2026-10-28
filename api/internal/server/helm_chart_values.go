package server

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

// HelmChartValuesHandler serves the chart's own values.yaml, so the deploy
// wizard can show and diff against the real chart defaults instead of a
// hand-copied baseline that drifts from upstream.
//
// GET /api/helm/chart-values?repoUrl=&chart=&version=
//
// repoUrl defaults to https://helm.gen3.org; version empty means the
// newest entry for the chart in the repo's index.
func HelmChartValuesHandler(c *gin.Context) {
	repoURL := strings.TrimRight(c.DefaultQuery("repoUrl", "https://helm.gen3.org"), "/")
	chart := c.Query("chart")
	version := c.Query("version")

	if !helmRepoSchemeCheck(repoURL) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the chart repository must be an https URL"})
		return
	}
	if !validHelmName.MatchString(chart) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chart is not a valid chart name"})
		return
	}
	if version != "" && !validHelmVersion.MatchString(version) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "version is not a valid chart version"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 90 * time.Second}

	values, err := chartValues(ctx, client, repoURL, chart, version)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, values)
}

var (
	validHelmName    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,253}$`)
	validHelmVersion = regexp.MustCompile(`^[0-9A-Za-z.-]{1,63}$`)

	// Overridable in tests, which serve over plain http.
	helmRepoSchemeCheck = func(raw string) bool { return strings.HasPrefix(raw, "https://") }
)

// helmIndexEntry is one version of a chart in a Helm repository index.
// Older indices carry a single `url`; newer ones an `urls` list.
type helmIndexEntry struct {
	Version string   `json:"version"`
	Created string   `json:"created"`
	URL     string   `json:"url"`
	URLs    []string `json:"urls"`
}

func (e helmIndexEntry) firstURL() string {
	if len(e.URLs) > 0 {
		return e.URLs[0]
	}
	return e.URL
}

func chartValues(ctx context.Context, client *http.Client, repoURL, chart, version string) (map[string]any, error) {
	if !helmRepoSchemeCheck(repoURL) {
		return nil, fmt.Errorf("the chart repository must be an https URL")
	}
	index, err := fetchHelmIndex(ctx, client, repoURL)
	if err != nil {
		return nil, fmt.Errorf("reading the chart repository index: %w", err)
	}
	entries, ok := index[chart]
	if !ok || len(entries) == 0 {
		return nil, fmt.Errorf("chart %q is not in the repository", chart)
	}
	entry, err := pickHelmEntry(entries, version)
	if err != nil {
		return nil, err
	}

	chartURL, err := resolveHelmURL(repoURL, entry.firstURL())
	if err != nil {
		return nil, err
	}
	if !helmRepoSchemeCheck(chartURL) {
		return nil, fmt.Errorf("the chart index points at a non-https location")
	}

	gz, err := fetchChart(ctx, client, chartURL)
	if err != nil {
		return nil, fmt.Errorf("downloading the chart: %w", err)
	}
	return valuesFromChartTarGZ(gz)
}

func fetchHelmIndex(ctx context.Context, client *http.Client, repoURL string) (map[string][]helmIndexEntry, error) {
	var index struct {
		Entries map[string][]helmIndexEntry `json:"entries"`
	}
	body, err := getURL(ctx, client, repoURL+"/index.yaml", 16<<20)
	if err != nil {
		return nil, err
	}
	if err := yaml.Unmarshal(body, &index); err != nil {
		return nil, fmt.Errorf("the repository index is not valid YAML: %w", err)
	}
	if index.Entries == nil {
		return nil, fmt.Errorf("the repository index lists no charts")
	}
	return index.Entries, nil
}

// pickHelmEntry returns the requested version, or the newest one: the
// index is not guaranteed to be ordered, so "newest" is by created time,
// falling back to the first listed.
func pickHelmEntry(entries []helmIndexEntry, version string) (helmIndexEntry, error) {
	if version == "" {
		newest := entries[0]
		for _, e := range entries[1:] {
			if strings.Compare(e.Created, newest.Created) > 0 {
				newest = e
			}
		}
		return newest, nil
	}
	for _, e := range entries {
		if e.Version == version {
			return e, nil
		}
	}
	available := make([]string, len(entries))
	for i, e := range entries {
		available[i] = e.Version
	}
	sort.Strings(available)
	return helmIndexEntry{}, fmt.Errorf("version %s of the chart is not in the repository (available: %s)", version, strings.Join(available, ", "))
}

// resolveHelmURL resolves a relative chart URL against the repository. (The
// archive may legitimately live on another host - e.g. GitHub releases -
// since the operator chose the repository; the https check is the guard.)
func resolveHelmURL(repoURL, raw string) (string, error) {
	if strings.Contains(raw, "://") {
		return raw, nil
	}
	base, err := url.Parse(repoURL)
	if err != nil {
		return "", err
	}
	u, err := url.Parse(strings.TrimPrefix(raw, "/"))
	if err != nil {
		return "", err
	}
	return base.ResolveReference(u).String(), nil
}

func getURL(ctx context.Context, client *http.Client, raw string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the chart repository answered %s", res.Status)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("the download is larger than %d bytes", limit)
	}
	return body, nil
}

func fetchChart(ctx context.Context, client *http.Client, raw string) ([]byte, error) {
	return getURL(ctx, client, raw, 64<<20)
}

// valuesFromChartTarGZ pulls <chart>/values.yaml out of a chart archive.
func valuesFromChartTarGZ(archive []byte) (map[string]any, error) {
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, fmt.Errorf("the chart is not a valid .tgz: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("the chart is not a valid .tgz: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg || !strings.HasSuffix(hdr.Name, "/values.yaml") {
			continue
		}
		parts := strings.Split(hdr.Name, "/")
		if len(parts) != 2 {
			continue // only the chart's top-level values.yaml
		}
		data, err := io.ReadAll(io.LimitReader(tr, 2<<20))
		if err != nil {
			return nil, err
		}
		var values map[string]any
		if err := yaml.Unmarshal(data, &values); err != nil {
			return nil, fmt.Errorf("the chart's values.yaml is not valid: %w", err)
		}
		return values, nil
	}
	return nil, errors.New("the chart archive has no values.yaml")
}
