package server

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// fakeChartRepo serves a two-version Helm repository on plain http.
func fakeChartRepo(t *testing.T) *httptest.Server {
	t.Helper()

	index := `apiVersion: v1
entries:
  gen3:
    - created: "2026-01-01T00:00:00Z"
      version: 0.2.0
      urls:
        - /gen3-0.2.0.tgz
    - created: "2026-06-01T00:00:00Z"
      version: 0.3.0
      urls:
        - /gen3-0.3.0.tgz
  other:
    - created: "2026-01-01T00:00:00Z"
      version: 1.0.0
      urls:
        - /other-1.0.0.tgz
`
	tgz := func(values string) []byte {
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		tw := tar.NewWriter(gz)
		name := "gen3/values.yaml"
		if values == "other: {}" {
			name = "other/values.yaml"
		}
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(values)), Typeflag: tar.TypeReg})
		tw.Write([]byte(values))
		tw.Close()
		gz.Close()
		return buf.Bytes()
	}
	gen3v2 := tgz("portal:\n  enabled: true\nfrontend-framework:\n  enabled: false\n")
	gen3v3 := tgz("portal:\n  enabled: false\nfrontend-framework:\n  enabled: true\n")

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/index.yaml":
			w.Write([]byte(index))
		case "/gen3-0.2.0.tgz":
			w.Write(gen3v2)
		case "/gen3-0.3.0.tgz":
			w.Write(gen3v3)
		case "/other-1.0.0.tgz":
			w.Write(tgz("other: {}"))
		default:
			http.NotFound(w, r)
		}
	}))
}

func chartValuesRequest(t *testing.T, repoURL string, query url.Values) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	q := url.Values{}
	if repoURL != "" {
		q.Set("repoUrl", repoURL)
	}
	for k, vs := range query {
		for _, v := range vs {
			q.Set(k, v)
		}
	}
	c.Request = httptest.NewRequest(http.MethodGet, "/api/helm/chart-values?"+q.Encode(), nil)
	HelmChartValuesHandler(c)
	return rec
}

func TestChartValuesReturnsTheChartDefaults(t *testing.T) {
	repo := fakeChartRepo(t)
	defer repo.Close()
	prev := helmRepoSchemeCheck
	helmRepoSchemeCheck = func(string) bool { return true }
	t.Cleanup(func() { helmRepoSchemeCheck = prev })

	rec := chartValuesRequest(t, repo.URL, url.Values{"chart": {"gen3"}, "version": {"0.3.0"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var values map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &values); err != nil {
		t.Fatal(err)
	}
	portal := values["portal"].(map[string]any)
	if portal["enabled"] != false {
		t.Errorf("portal.enabled = %v, want the chart's false", portal["enabled"])
	}
	if values["frontend-framework"].(map[string]any)["enabled"] != true {
		t.Errorf("frontend-framework.enabled = %v, want the chart's true", values["frontend-framework"])
	}
}

func TestChartValuesDefaultsToTheNewestVersion(t *testing.T) {
	repo := fakeChartRepo(t)
	defer repo.Close()
	prev := helmRepoSchemeCheck
	helmRepoSchemeCheck = func(string) bool { return true }
	t.Cleanup(func() { helmRepoSchemeCheck = prev })

	rec := chartValuesRequest(t, repo.URL, url.Values{"chart": {"gen3"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var values map[string]any
	json.Unmarshal(rec.Body.Bytes(), &values)
	// 0.3.0 is the newest by created; its values say the new frontend is on.
	if values["frontend-framework"].(map[string]any)["enabled"] != true {
		t.Errorf("newest version's values = %v, want the 0.3.0 defaults", values)
	}
}

func TestChartValuesRejectsBadInput(t *testing.T) {
	repo := fakeChartRepo(t)
	defer repo.Close()
	prev := helmRepoSchemeCheck
	helmRepoSchemeCheck = func(string) bool { return true }
	t.Cleanup(func() { helmRepoSchemeCheck = prev })

	if rec := chartValuesRequest(t, repo.URL, url.Values{"chart": {"../etc"}}); rec.Code != http.StatusBadRequest {
		t.Errorf("hostile chart name: status = %d", rec.Code)
	}
	if rec := chartValuesRequest(t, repo.URL, url.Values{"chart": {"gen3"}, "version": {"0.1;rm"}}); rec.Code != http.StatusBadRequest {
		t.Errorf("hostile version: status = %d", rec.Code)
	}
	// The real scheme check (not the test override).
	helmRepoSchemeCheck = func(raw string) bool { return strings.HasPrefix(raw, "https://") }
	if rec := chartValuesRequest(t, "http://plain.example", url.Values{"chart": {"gen3"}}); rec.Code != http.StatusBadRequest {
		t.Errorf("http repository: status = %d, want 400", rec.Code)
	}
}

func TestChartValuesUnknownChartAndVersion(t *testing.T) {
	repo := fakeChartRepo(t)
	defer repo.Close()
	prev := helmRepoSchemeCheck
	helmRepoSchemeCheck = func(string) bool { return true }
	t.Cleanup(func() { helmRepoSchemeCheck = prev })

	if rec := chartValuesRequest(t, repo.URL, url.Values{"chart": {"nope"}}); rec.Code != http.StatusBadGateway {
		t.Errorf("unknown chart: status = %d", rec.Code)
	}
	if rec := chartValuesRequest(t, repo.URL, url.Values{"chart": {"gen3"}, "version": {"9.9.9"}}); rec.Code != http.StatusBadGateway {
		t.Errorf("unknown version: status = %d", rec.Code)
	}
}
