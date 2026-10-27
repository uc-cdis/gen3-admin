package gitops

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func testInputs() CSOCInputs {
	return CSOCInputs{
		Name:         "csoc-dev",
		Repo:         Repo{Owner: "example-org", Name: "csoc-gitops", BaseBranch: "main"},
		Region:       "us-east-1",
		ClusterName:  "csoc-dev",
		VPCID:        "vpc-0123456789abcdef0",
		LBRoleARN:    "arn:aws:iam::123456789012:role/csoc-dev-lb-controller",
		ESORoleARN:   "arn:aws:iam::123456789012:role/csoc-dev-external-secrets",
		APIRoleARN:   "arn:aws:iam::123456789012:role/csoc-dev-csoc-api",
		CertARN:      "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555",
		CSOCHost:     "csoc.example.org",
		KeycloakHost: "auth.csoc.example.org",
		StateBucket:  "example-csoc-state",
		AdminEmail:   "admin@example.org",
		AllowedCIDRs: []string{"203.0.113.7/32", "198.51.100.0/24", "203.0.113.7/32"},
		Chart:        ChartSource{RepoURL: "https://github.com/uc-cdis/gen3-admin.git", Path: "helm/csoc", Revision: "master"},
		Versions:     DefaultVersions,
	}
}

func renderTest(t *testing.T) *Rendered {
	t.Helper()
	r, err := RenderCSOC(testInputs())
	if err != nil {
		t.Fatalf("RenderCSOC: %v", err)
	}
	return r
}

func file(t *testing.T, r *Rendered, rel string) string {
	t.Helper()
	for _, f := range r.Files {
		if f.Path == r.Dir+"/"+rel {
			return string(f.Content)
		}
	}
	t.Fatalf("%s was not rendered", rel)
	return ""
}

func TestRenderCSOCFilesAreValidYAML(t *testing.T) {
	r := renderTest(t)
	if len(r.Files) < 15 {
		t.Fatalf("rendered %d files, want the whole CSOC directory", len(r.Files))
	}
	for _, f := range r.Files {
		if !strings.HasPrefix(f.Path, "csoc-dev/") {
			t.Errorf("%s is outside the CSOC's directory", f.Path)
		}
		if !strings.HasSuffix(f.Path, ".yaml") {
			continue
		}
		dec := yaml.NewDecoder(bytes.NewReader(f.Content))
		for {
			var doc map[string]any
			err := dec.Decode(&doc)
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				t.Fatalf("%s: %v\n%s", f.Path, err, f.Content)
			}
			if strings.Contains(f.Path, "/apps/") && doc["kind"] != "Application" {
				t.Errorf("%s: kind %v, want Application", f.Path, doc["kind"])
			}
		}
	}
}

func TestRenderCSOCAllowlistEverywhere(t *testing.T) {
	r := renderTest(t)
	want := "198.51.100.0/24,203.0.113.7/32"
	for _, rel := range []string{"values/csoc.yaml", "manifests/keycloak.yaml"} {
		if !strings.Contains(file(t, r, rel), `inbound-cidrs: "`+want+`"`) {
			t.Errorf("%s does not restrict the ALB to %s", rel, want)
		}
	}
	csoc := file(t, r, "values/csoc.yaml")
	for _, c := range []string{`- "198.51.100.0/24"`, `- "203.0.113.7/32"`} {
		if !strings.Contains(csoc, c) {
			t.Errorf("NLB source ranges miss %s", c)
		}
	}
}

func TestRenderCSOCBootstrapMatchesRepo(t *testing.T) {
	r := renderTest(t)
	for name, rel := range bootstrapFiles {
		if string(r.Bootstrap[name]) != file(t, r, rel) {
			t.Errorf("bootstrap %s differs from repo %s", name, rel)
		}
	}
	root := string(r.Bootstrap["root.yaml"])
	for _, s := range []string{`"https://github.com/example-org/csoc-gitops.git"`, "path: csoc-dev/apps", `targetRevision: "main"`} {
		if !strings.Contains(root, s) {
			t.Errorf("root.yaml is missing %s", s)
		}
	}
}

func TestRenderCSOCWithoutRepo(t *testing.T) {
	in := testInputs()
	in.Repo = Repo{}
	r, err := RenderCSOC(in)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range r.Files {
		if rel := strings.TrimPrefix(f.Path, r.Dir+"/"); gitOpsOnly(rel) {
			t.Errorf("rendered the GitOps-only file %s", rel)
		}
		if strings.Contains(string(f.Content), "github.com/example-org") {
			t.Errorf("%s refers to a repo", f.Path)
		}
	}
	if len(r.Bootstrap) == 0 || r.Bootstrap["values/csoc.yaml"] == nil || r.Bootstrap["manifests/secret-store.yaml"] == nil {
		t.Errorf("bootstrap files = %d, want every applied file by its path", len(r.Bootstrap))
	}
}

func TestRenderCSOCOnlyNamesSecrets(t *testing.T) {
	r := renderTest(t)
	creds := file(t, r, "manifests/repo-creds.yaml")
	for _, s := range []string{`key: "gen3-csoc/csoc-dev/github-app"`, `githubAppPrivateKey: "{{ .private_key }}"`, "argocd.argoproj.io/secret-type: repo-creds"} {
		if !strings.Contains(creds, s) {
			t.Errorf("repo-creds.yaml is missing %s", s)
		}
	}
	realm := file(t, r, "manifests/realm.yaml")
	if !strings.Contains(realm, `value: "${ADMIN_PASSWORD}"`) || !strings.Contains(realm, `secret: "${CLIENT_SECRET}"`) {
		t.Error("realm import must take the admin password and client secret from placeholders")
	}
}

func TestRenderCSOCRejectsBadInputs(t *testing.T) {
	cases := map[string]func(*CSOCInputs){
		"open to the world": func(in *CSOCInputs) { in.AllowedCIDRs = []string{"0.0.0.0/0"} },
		"no allowlist":      func(in *CSOCInputs) { in.AllowedCIDRs = nil },
		"yaml in hostname":  func(in *CSOCInputs) { in.CSOCHost = "a.org\n  evil: true" },
		"bad role":          func(in *CSOCInputs) { in.ESORoleARN = "arn:aws:iam::1:role/x" },
		"bad repo":          func(in *CSOCInputs) { in.Repo.Owner = "../x" },
		"bad image":         func(in *CSOCInputs) { in.APIImage = &Image{Repository: "Quay.io/X", Tag: "1"} },
	}
	for name, mutate := range cases {
		in := testInputs()
		mutate(&in)
		if _, err := RenderCSOC(in); err == nil {
			t.Errorf("%s: rendered, want an error", name)
		}
	}
}

func TestRenderCSOCImages(t *testing.T) {
	in := testInputs()
	in.APIImage = SplitImage("quay.io/cdis/csoc-api:2026.10")
	r, err := RenderCSOC(in)
	if err != nil {
		t.Fatal(err)
	}
	v := file(t, r, "values/csoc.yaml")
	if !strings.Contains(v, `repository: "quay.io/cdis/csoc-api"`) || !strings.Contains(v, `tag: "2026.10"`) {
		t.Errorf("API image not set:\n%s", v)
	}
	if strings.Contains(v, "frontend:\n    repository") {
		t.Error("frontend image set although none was given")
	}
}

func TestSplitImage(t *testing.T) {
	if got := SplitImage("localhost:5000/csoc-api"); got.Tag != "" {
		t.Errorf("registry port taken for a tag: %+v", got)
	}
	if got := SplitImage("quay.io/x/y:1.2"); got.Repository != "quay.io/x/y" || got.Tag != "1.2" {
		t.Errorf("SplitImage = %+v", got)
	}
}
