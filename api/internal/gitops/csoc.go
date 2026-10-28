package gitops

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"text/template"
)

//go:embed templates
var templateFS embed.FS

// Versions pins every component the CSOC repo deploys. A bump is a CSOC
// release, and reaches an existing CSOC as a PR like any other change.
type Versions struct {
	ArgoCD          string
	ExternalSecrets string
	LBController    string
	CNPG            string
	Keycloak        string
	// ExternalDNS writes the commons' DNS records (direct installs).
	ExternalDNS string
	// EBSCSI is the aws-ebs-csi-driver chart, the version gen3-helm's
	// cluster-level-resources pins.
	EBSCSI string
}

var DefaultVersions = Versions{
	ArgoCD:          "10.10.3",
	ExternalSecrets: "2.12.0",
	LBController:    "3.6.0",
	CNPG:            "0.29.1",
	Keycloak:        "26.6.1",
	ExternalDNS:     "1.15.2",
	EBSCSI:          "2.48.0",
}

// ChartSource is where ArgoCD gets the CSOC chart.
type ChartSource struct {
	RepoURL  string
	Path     string
	Revision string
}

// DefaultChart is the published gen3-admin chart. CSOC_CHART_REPO and
// CSOC_CHART_REVISION point a test CSOC at a fork or branch.
func DefaultChart() ChartSource {
	c := ChartSource{RepoURL: "https://github.com/uc-cdis/gen3-admin.git", Path: "helm/csoc", Revision: "master"}
	if v := os.Getenv("CSOC_CHART_REPO"); v != "" {
		c.RepoURL = v
	}
	if v := os.Getenv("CSOC_CHART_REVISION"); v != "" {
		c.Revision = v
	}
	return c
}

// Image is a repository:tag split for the chart's image values.
type Image struct {
	Repository string
	Tag        string
}

// CSOCInputs is everything the CSOC repo directory is rendered from. All of
// it is configuration; none of it is secret.
type CSOCInputs struct {
	// Name is the CSOC environment, and its directory in the repo.
	Name string
	// Repo is the GitOps repo. Zero means the CSOC has none yet, and the
	// install applies the rendered files itself instead of ArgoCD.
	Repo   Repo
	Region string

	ClusterName string
	VPCID       string
	LBRoleARN   string
	ESORoleARN  string
	APIRoleARN  string
	// EBSRoleARN is the EBS CSI driver's IRSA role. Empty for environments
	// applied while the driver was an EKS add-on: they have it already.
	EBSRoleARN   string
	CertARN      string
	CSOCHost     string
	KeycloakHost string
	StateBucket  string
	AdminEmail   string
	AllowedCIDRs []string

	APIImage      *Image
	FrontendImage *Image
	// AgentImage is what the CSOC API deploys as the agent. Nil: its own
	// default.
	AgentImage *Image

	Chart    ChartSource
	Versions Versions
}

// renderData is what the templates see.
type renderData struct {
	CSOCInputs
	Dir         string
	Branch      string
	Namespace   string
	SecretStore string
}

const (
	csocNamespace   = "csoc"
	csocSecretStore = "csoc-secrets-manager"
)

// SecretPrefix is where a CSOC's secrets live in Secrets Manager. The ESO
// role and the CSOC API role are both scoped to it.
func SecretPrefix(csoc string) string { return "gen3-csoc/" + csoc + "/" }

// SecretName is the Secrets Manager name of one of a CSOC's secrets.
func SecretName(csoc, name string) string { return SecretPrefix(csoc) + name }

// The secrets the bootstrap generates. github-app is written by the API when
// the repo is connected.
const (
	SecretGitHubApp      = "github-app"
	SecretKeycloakAdmin  = "keycloak-admin"
	SecretKeycloakClient = "keycloak-client"
	SecretNextAuth       = "nextauth"
)

// URLPrefix is the repo-creds URL. ArgoCD matches credentials by prefix, so
// this covers the repo with or without ".git".
func (r Repo) URLPrefix() string { return "https://github.com/" + r.Owner + "/" + r.Name }

// Direct reports whether the CSOC is installed without a GitOps repo.
func (in *CSOCInputs) Direct() bool { return in.Repo == (Repo{}) }

var (
	validEnvName  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	validHost     = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	validRegion   = regexp.MustCompile(`^[a-z]{2}(-gov)?-[a-z]+-[0-9]$`)
	validRoleARN  = regexp.MustCompile(`^arn:aws[a-z-]*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$`)
	validCertARN  = regexp.MustCompile(`^arn:aws[a-z-]*:acm:[a-z0-9-]+:[0-9]{12}:certificate/[0-9a-f-]{36}$`)
	validVPC      = regexp.MustCompile(`^vpc-[0-9a-f]{8,17}$`)
	validCluster  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`)
	validBucket   = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	validEmail    = regexp.MustCompile(`^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$`)
	validImageRep = regexp.MustCompile(`^[a-z0-9]+([._/-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)*$`)
	validImageTag = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
	validVersion  = regexp.MustCompile(`^v?[0-9]+\.[0-9]+\.[0-9]+$`)
	validRevision = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,200}$`)
	validChartURL = regexp.MustCompile(`^https://[A-Za-z0-9.-]+/[A-Za-z0-9._/-]+$`)
	validRelPath  = regexp.MustCompile(`^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`)
)

// Validate checks every input against what it may be. Inputs come from
// Terraform outputs and the wizard, and end up in YAML that a cluster
// applies, so they are held to exact formats rather than escaped.
func (in *CSOCInputs) Validate() error {
	checks := []struct {
		name, v string
		re      *regexp.Regexp
	}{
		{"name", in.Name, validEnvName},
		{"region", in.Region, validRegion},
		{"cluster name", in.ClusterName, validCluster},
		{"VPC ID", in.VPCID, validVPC},
		{"load balancer controller role", in.LBRoleARN, validRoleARN},
		{"external secrets role", in.ESORoleARN, validRoleARN},
		{"CSOC API role", in.APIRoleARN, validRoleARN},
		{"certificate ARN", in.CertARN, validCertARN},
		{"CSOC hostname", in.CSOCHost, validHost},
		{"Keycloak hostname", in.KeycloakHost, validHost},
		{"state bucket", in.StateBucket, validBucket},
		{"admin email", in.AdminEmail, validEmail},
		{"chart repo", in.Chart.RepoURL, validChartURL},
		{"chart path", in.Chart.Path, validRelPath},
		{"chart revision", in.Chart.Revision, validRevision},
	}
	if in.EBSRoleARN != "" {
		checks = append(checks, struct {
			name, v string
			re      *regexp.Regexp
		}{"EBS CSI driver role", in.EBSRoleARN, validRoleARN})
	}
	for _, c := range checks {
		if !c.re.MatchString(c.v) {
			return fmt.Errorf("%s %q is not valid", c.name, c.v)
		}
	}
	if !in.Direct() {
		if err := in.Repo.Validate(); err != nil {
			return err
		}
	}
	for _, v := range []string{in.Versions.ArgoCD, in.Versions.ExternalSecrets, in.Versions.LBController, in.Versions.CNPG, in.Versions.Keycloak, in.Versions.EBSCSI} {
		if !validVersion.MatchString(v) {
			return fmt.Errorf("component version %q is not valid", v)
		}
	}
	for _, img := range []*Image{in.APIImage, in.FrontendImage, in.AgentImage} {
		if img != nil && (!validImageRep.MatchString(img.Repository) || !validImageTag.MatchString(img.Tag)) {
			return fmt.Errorf("image %s:%s is not valid", img.Repository, img.Tag)
		}
	}
	cidrs, err := NormalizeCIDRs(in.AllowedCIDRs)
	if err != nil {
		return err
	}
	in.AllowedCIDRs = cidrs
	return nil
}

// NormalizeCIDRs checks an allowlist and returns it sorted and de-duplicated.
// It refuses /0 outright: the allowlist is CSOC's outer wall.
func NormalizeCIDRs(cidrs []string) ([]string, error) {
	if len(cidrs) == 0 {
		return nil, errors.New("at least one allowed CIDR is required")
	}
	seen := map[string]bool{}
	var out []string
	for _, c := range cidrs {
		ip, n, err := net.ParseCIDR(strings.TrimSpace(c))
		if err != nil || ip.To4() == nil {
			return nil, fmt.Errorf("allowed CIDR %q is not an IPv4 CIDR", c)
		}
		if ones, _ := n.Mask.Size(); ones == 0 {
			return nil, errors.New("0.0.0.0/0 would open CSOC to the internet")
		}
		if s := n.String(); !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	if len(out) > 50 {
		return nil, errors.New("at most 50 allowed CIDRs")
	}
	sort.Strings(out)
	return out, nil
}

// SplitImage turns "repo:tag" into an Image; "" gives nil.
func SplitImage(ref string) *Image {
	if ref == "" {
		return nil
	}
	i := strings.LastIndex(ref, ":")
	if i < 0 || strings.Contains(ref[i:], "/") {
		return &Image{Repository: ref}
	}
	return &Image{Repository: ref[:i], Tag: ref[i+1:]}
}

// Rendered is the CSOC's directory in the repo, plus the subset the
// bootstrap applies to the cluster before ArgoCD can.
type Rendered struct {
	Dir   string
	Files []File
	// Bootstrap maps a file name to content the install script uses
	// directly. Each is byte-for-byte the file at the same repo path, so
	// ArgoCD takes over what the bootstrap created without changing it.
	// Without a repo it holds every file the install applies, keyed by its
	// path in the CSOC's directory.
	Bootstrap map[string][]byte
}

// The repo files the bootstrap needs, keyed by the name it reads them as.
var bootstrapFiles = map[string]string{
	"argocd-values.yaml":           "values/argocd.yaml",
	"external-secrets-values.yaml": "values/external-secrets.yaml",
	"secret-store.yaml":            "manifests/secret-store.yaml",
	"repo-creds.yaml":              "manifests/repo-creds.yaml",
	"root.yaml":                    "root.yaml",
}

// gitOpsOnly are the files that only mean something to ArgoCD: the
// Applications, the root that syncs them, and ArgoCD's own install and repo
// login. A CSOC without a repo leaves them out.
func gitOpsOnly(rel string) bool {
	return strings.HasPrefix(rel, "apps/") ||
		rel == "root.yaml" || rel == "values/argocd.yaml" || rel == "manifests/repo-creds.yaml"
}

// RenderCSOC renders the CSOC's directory.
func RenderCSOC(in CSOCInputs) (*Rendered, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	branch := in.Repo.BaseBranch
	if branch == "" && !in.Direct() {
		return nil, errors.New("the repo's base branch must be known to render")
	}
	data := renderData{CSOCInputs: in, Dir: in.Name, Branch: branch, Namespace: csocNamespace, SecretStore: csocSecretStore}

	const root = "templates/csoc"
	shared, err := fs.ReadFile(templateFS, root+"/shared.tmpl")
	if err != nil {
		return nil, err
	}
	out := &Rendered{Dir: in.Name, Bootstrap: map[string][]byte{}}
	err = fs.WalkDir(templateFS, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".tmpl") || path.Base(p) == "shared.tmpl" {
			return err
		}
		body, err := fs.ReadFile(templateFS, p)
		if err != nil {
			return err
		}
		t, err := template.New(path.Base(p)).Funcs(funcs).Option("missingkey=error").Parse(string(body))
		if err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
		if _, err := t.New("shared").Parse(string(shared)); err != nil {
			return err
		}
		var buf bytes.Buffer
		if err := t.Execute(&buf, data); err != nil {
			return fmt.Errorf("%s: %w", p, err)
		}
		rel := strings.TrimSuffix(strings.TrimPrefix(p, root+"/"), ".tmpl")
		// A template that renders nothing is a component this CSOC leaves out.
		if len(bytes.TrimSpace(buf.Bytes())) == 0 {
			return nil
		}
		if in.Direct() && gitOpsOnly(rel) {
			return nil
		}
		content := append(bytes.TrimRight(buf.Bytes(), "\n"), '\n')
		repoPath := in.Name + "/" + rel
		if err := Guard(repoPath, content); err != nil {
			return err
		}
		out.Files = append(out.Files, File{Path: repoPath, Content: content})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out.Files, func(i, j int) bool { return out.Files[i].Path < out.Files[j].Path })
	if in.Direct() {
		for _, f := range out.Files {
			if strings.HasSuffix(f.Path, ".yaml") {
				out.Bootstrap[strings.TrimPrefix(f.Path, in.Name+"/")] = f.Content
			}
		}
		return out, nil
	}
	byPath := map[string][]byte{}
	for _, f := range out.Files {
		byPath[f.Path] = f.Content
	}
	for name, rel := range bootstrapFiles {
		content, ok := byPath[in.Name+"/"+rel]
		if !ok {
			return nil, fmt.Errorf("bootstrap file %s was not rendered", rel)
		}
		out.Bootstrap[name] = content
	}
	return out, nil
}

// appArgs are the helmApp template's arguments.
type appArgs struct {
	Root                                       renderData
	Name, Namespace, ChartRepo, Chart, Version string
	Wave                                       string
}

var funcs = template.FuncMap{
	// q renders a string as a double-quoted YAML scalar.
	"q": func(s string) string {
		b, _ := json.Marshal(s)
		return string(b)
	},
	"join": strings.Join,
	"secret": func(d renderData, name string) string {
		return SecretName(d.Name, name)
	},
	"app": func(d renderData, name, ns, repo, chart, version, wave string) appArgs {
		return appArgs{Root: d, Name: name, Namespace: ns, ChartRepo: repo, Chart: chart, Version: version, Wave: wave}
	},
}
