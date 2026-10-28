package terraform

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	awslookup "github.com/uc-cdis/gen3-admin/internal/aws"
	"github.com/uc-cdis/gen3-admin/internal/environments"
	"github.com/uc-cdis/gen3-admin/internal/gitops"
)

// Installing CSOC onto the cluster an environment's apply created takes two
// runs. With a GitOps repo connected they sit either side of a pull request,
// because everything CSOC runs is deployed by ArgoCD from the repo:
//
//  1. install-csoc puts ArgoCD and External Secrets on the cluster, creates
//     the CSOC's secrets in Secrets Manager, and points ArgoCD at the repo.
//     The API then opens the PR with the CSOC's configuration.
//  2. Once the PR is merged and ArgoCD has synced it, finish-csoc waits for
//     the ALB, creates the DNS records, and removes the bootstrap password.
//
// Without a repo, install-csoc applies the same rendered files with Helm and
// kubectl itself. finish-csoc applies them again, now with the egress IP the
// install found in the allowlist, then does the same DNS and password steps.
//
// Neither is a Terraform command: the runner image runs a fixed script from
// scripts/runner instead of the Terraform prelude.
const (
	OpInstallCSOC TerraformOperation = "install-csoc"
	OpFinishCSOC  TerraformOperation = "finish-csoc"
	// OpUninstallCSOC removes what the install put in the cluster and in AWS
	// outside Terraform (load balancers, volumes, Karpenter's nodes, DNS
	// records, secrets), so a destroy that follows neither hangs nor orphans.
	OpUninstallCSOC TerraformOperation = "uninstall-csoc"
)

func isScriptOp(op TerraformOperation) bool {
	return op == OpInstallCSOC || op == OpFinishCSOC || op == OpUninstallCSOC
}

// Where the gen3-admin runner scripts are mounted in the runner.
const (
	containerRepoDir      = "/gen3-admin"
	installSecretsPrefix  = "install-secrets-"
	bootstrapDirPrefix    = "bootstrap-"
	installResultFile     = "install-result.json"
	minAdminPasswordChars = 12
)

func scriptFor(op TerraformOperation) string {
	return containerRepoDir + "/scripts/runner/" + string(op) + ".sh"
}

// InstallOptions are the parts of an install the operator chooses. Everything
// about the cluster itself comes from the environment's Terraform outputs.
type InstallOptions struct {
	// AllowedCIDRs may reach the CSOC and Keycloak ALB and the agent NLB.
	AllowedCIDRs  []string `json:"allowed_cidrs"`
	AdminEmail    string   `json:"admin_email,omitempty"`
	AdminPassword string   `json:"admin_password"`
	APIImage      string   `json:"api_image,omitempty"`
	FrontendImage string   `json:"frontend_image,omitempty"`
	// CertificateARN is the ACM certificate the load balancer serves, chosen
	// on the wizard's Certificate step. Empty falls back to one Terraform
	// made, for environments planned before that step existed.
	CertificateARN string `json:"certificate_arn,omitempty"`
}

var (
	// The password reaches the cluster through a shell env file in single
	// quotes, so neither quote, backslash, nor anything that could start an
	// expansion is allowed.
	validAdminPassword = regexp.MustCompile(`^[A-Za-z0-9 !#%&()*+,./:;<=>?@\[\]^_{|}~-]{12,128}$`)
	validEmail         = regexp.MustCompile(`^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$`)
	validHostname      = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	validClusterName   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`)
	validZoneID        = regexp.MustCompile(`^Z[A-Z0-9]{1,31}$`)
	validEgressIP      = regexp.MustCompile(`^[0-9]{1,3}(\.[0-9]{1,3}){3}$`)
	validCertARN       = regexp.MustCompile(`^arn:aws[a-z-]*:acm:[a-z0-9-]+:[0-9]{12}:certificate/[0-9a-f-]{36}$`)
)

// certificateStatus reads a certificate's ACM status; replaced in tests.
var certificateStatus = awslookup.CertificateStatus

func validateInstallOptions(o *InstallOptions) error {
	if o == nil {
		return fmt.Errorf("install-csoc needs install options")
	}
	cidrs, err := gitops.NormalizeCIDRs(o.AllowedCIDRs)
	if err != nil {
		return err
	}
	o.AllowedCIDRs = cidrs
	if !validAdminPassword.MatchString(o.AdminPassword) {
		return fmt.Errorf("admin password must be %d-128 characters, without quotes, backslashes, $ or `", minAdminPasswordChars)
	}
	if o.AdminEmail != "" && !validEmail.MatchString(o.AdminEmail) {
		return fmt.Errorf("admin email is not valid")
	}
	if o.CertificateARN != "" && !validCertARN.MatchString(o.CertificateARN) {
		return fmt.Errorf("certificate_arn is not an ACM certificate ARN")
	}
	for _, img := range []string{o.APIImage, o.FrontendImage} {
		if img != "" && (!validImageRef.MatchString(img) || !strings.Contains(img, ":")) {
			return fmt.Errorf("image %q must be a repository:tag reference", img)
		}
	}
	return nil
}

// scriptInputs maps outputs onto a script's env, checking each one. Outputs
// come from Terraform state rather than the browser, but they still reach a
// shell script, so they are held to the same standard as request values.
func scriptInputs(e *environments.Environment, checks []outputCheck) (map[string]string, error) {
	in := map[string]string{}
	var missing []string
	for _, c := range checks {
		var v string
		_ = json.Unmarshal(e.Outputs[c.output], &v)
		switch {
		case v == "" && c.optional:
			continue
		case v == "":
			missing = append(missing, c.output)
		case !c.re.MatchString(v):
			return nil, fmt.Errorf("terraform output %s has an unexpected value", c.output)
		default:
			in[c.env] = v
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("environment %s is missing terraform outputs %s; apply it with a module version that has them",
			e.Name, strings.Join(missing, ", "))
	}
	return in, nil
}

type outputCheck struct {
	env, output string
	re          *regexp.Regexp
	optional    bool
}

var (
	installChecks = []outputCheck{
		{"CLUSTER_NAME", "cluster_name", validClusterName, false},
		{"AWS_REGION", "aws_region", validRegion, false},
		// For external-dns, which points commons' hostnames at their load
		// balancers; absent for environments planned before it existed.
		{"EXTERNAL_DNS_ROLE_ARN", "external_dns_role_arn", validRoleARN, true},
		{"HOSTED_ZONE_ID", "hosted_zone_id", validZoneID, true},
		{"CSOC_HOSTNAME", "csoc_hostname", validHostname, true},
		{"KEYCLOAK_HOSTNAME", "keycloak_hostname", validHostname, true},
	}
	finishChecks = []outputCheck{
		{"CLUSTER_NAME", "cluster_name", validClusterName, false},
		{"AWS_REGION", "aws_region", validRegion, false},
		{"CSOC_HOSTNAME", "csoc_hostname", validHostname, false},
		{"KEYCLOAK_HOSTNAME", "keycloak_hostname", validHostname, false},
		{"HOSTED_ZONE_ID", "hosted_zone_id", validZoneID, true},
	}
)

// prepareScript loads the environment a script run targets and resolves the
// script's inputs into req.installEnv (and, for install-csoc, the files it
// applies into req.installFiles).
func prepareScript(ctx context.Context, req *TerraformRequest) error {
	if req.Environment == "" {
		return fmt.Errorf("%s needs an environment", req.Operation)
	}
	if req.Operation == OpInstallCSOC {
		if err := validateInstallOptions(req.Install); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	store, err := environments.OpenStore(ctx, req.StateBucket, runTarget(req))
	if err != nil {
		return err
	}
	e, err := store.Get(ctx, req.Environment)
	if err != nil {
		return fmt.Errorf("load environment %s: %w", req.Environment, err)
	}
	if e.Kind != environments.KindCSOC {
		return fmt.Errorf("environment %s is a %s, not a CSOC", e.Name, e.Kind)
	}

	var in map[string]string
	switch req.Operation {
	case OpInstallCSOC:
		in, err = prepareInstall(ctx, store, e, req)
	case OpFinishCSOC:
		in, err = prepareFinish(e, req)
	case OpUninstallCSOC:
		in, err = scriptInputs(e, finishChecks)
		if err == nil {
			in["SECRET_PREFIX"] = gitops.SecretPrefix(e.Name)
			if req.Force {
				in["FORCE"] = "1"
			}
		}
	}
	if err != nil {
		return err
	}
	in["ENVIRONMENT"] = e.Name
	if req.AWSRegion == "" {
		req.AWSRegion = in["AWS_REGION"]
	}
	req.installEnv = in
	return nil
}

func prepareInstall(ctx context.Context, store *environments.Store, e *environments.Environment, req *TerraformRequest) (map[string]string, error) {
	in, err := scriptInputs(e, installChecks)
	if err != nil {
		return nil, err
	}
	o := req.Install
	mode := environments.InstallGitOps
	if e.GitOps == nil {
		mode = environments.InstallDirect
	}
	if e.Install != nil && e.Install.Mode != "" && e.Install.Mode != mode && e.Status == environments.StatusInstalled {
		return nil, fmt.Errorf("environment %s was installed in %s mode; switching an installed CSOC to %s is not supported yet",
			e.Name, e.Install.Mode, mode)
	}
	install := &environments.Install{
		Mode: mode, AllowedCIDRs: o.AllowedCIDRs, AdminEmail: o.AdminEmail, APIImage: o.APIImage, FrontendImage: o.FrontendImage,
		CertificateARN: o.CertificateARN,
	}
	if e.Install != nil {
		install.EgressIP = e.Install.EgressIP
		install.LoadBalancer = e.Install.LoadBalancer
	}
	if install.CertificateARN != "" {
		// The load balancer controller will not serve a certificate ACM has
		// not issued; better to say so now than as a stuck ingress later.
		t := runTarget(req)
		t.Region = in["AWS_REGION"]
		status, err := certificateStatus(ctx, t, install.CertificateARN)
		if err != nil {
			return nil, fmt.Errorf("check the certificate: %w", err)
		}
		if status != "ISSUED" {
			return nil, fmt.Errorf("the certificate is %s, not issued yet; finish its validation on the Certificate step", strings.ToLower(strings.ReplaceAll(status, "_", " ")))
		}
	}
	e.Install = install

	// Rendering here, before anything runs, means a bad output or setting
	// fails the request instead of a half-done install.
	inputs, err := gitops.CSOCInputsFor(e, req.StateBucket)
	if err != nil {
		return nil, err
	}
	rendered, err := gitops.RenderCSOC(inputs)
	if err != nil {
		return nil, err
	}
	if _, err := store.Update(ctx, e.Name, func(stored *environments.Environment) { stored.Install = install }); err != nil {
		return nil, fmt.Errorf("record install settings: %w", err)
	}
	req.installFiles = rendered.Bootstrap
	in["INSTALL_MODE"] = mode
	in["SECRET_PREFIX"] = gitops.SecretPrefix(e.Name)
	in["ARGOCD_CHART_VERSION"] = inputs.Versions.ArgoCD
	in["ESO_CHART_VERSION"] = inputs.Versions.ExternalSecrets
	in["LBC_CHART_VERSION"] = inputs.Versions.LBController
	in["EXTERNAL_DNS_CHART_VERSION"] = inputs.Versions.ExternalDNS
	in["CNPG_CHART_VERSION"] = inputs.Versions.CNPG
	in["EBS_CSI_CHART_VERSION"] = inputs.Versions.EBSCSI
	return in, nil
}

func prepareFinish(e *environments.Environment, req *TerraformRequest) (map[string]string, error) {
	switch e.Status {
	case environments.StatusBootstrapped, environments.StatusInstalled:
	default:
		return nil, fmt.Errorf("environment %s is %s; run install-csoc first", e.Name, e.Status)
	}
	if !e.Install.Direct() {
		if e.GitOps == nil {
			return nil, fmt.Errorf("environment %s has no GitOps repo connected", e.Name)
		}
		if pr := e.GitOps.PullRequest; pr == nil || !pr.Merged {
			return nil, fmt.Errorf("merge the CSOC configuration PR first; ArgoCD deploys CSOC from the merged repo")
		}
		in, err := scriptInputs(e, finishChecks)
		if err == nil {
			in["INSTALL_MODE"] = environments.InstallGitOps
		}
		return in, err
	}
	in, err := scriptInputs(e, finishChecks)
	if err != nil {
		return nil, err
	}
	// Re-rendered from what was recorded, so the allowlist now has the
	// egress IP the install found.
	inputs, err := gitops.CSOCInputsFor(e, req.StateBucket)
	if err != nil {
		return nil, err
	}
	rendered, err := gitops.RenderCSOC(inputs)
	if err != nil {
		return nil, err
	}
	req.installFiles = rendered.Bootstrap
	in["INSTALL_MODE"] = environments.InstallDirect
	return in, nil
}

// writeScriptFiles writes what a script run needs besides its env: for
// install-csoc, the admin login in a 0600 env file the script sources; and
// the manifests rendered from the repo, which a direct finish-csoc applies
// again. Both are removed when the run ends.
func writeScriptFiles(req *TerraformRequest, executionID string) (secrets, bootstrap string, err error) {
	if req.Operation != OpInstallCSOC && len(req.installFiles) == 0 {
		return "", "", nil
	}
	vars := req.WorkDir + "-vars"
	if req.Operation == OpInstallCSOC {
		secrets = filepath.Join(vars, installSecretsPrefix+executionID+".env")
		body := fmt.Sprintf("CSOC_ADMIN_PASSWORD='%s'\n", req.Install.AdminPassword)
		if err := os.WriteFile(secrets, []byte(body), 0o600); err != nil {
			return "", "", fmt.Errorf("write install secrets: %w", err)
		}
	}
	bootstrap = filepath.Join(vars, bootstrapDirPrefix+executionID)
	if err := os.Mkdir(bootstrap, 0o700); err != nil {
		return secrets, "", fmt.Errorf("write bootstrap files: %w", err)
	}
	for name, content := range req.installFiles {
		// Names are the renderer's own repo paths, never request input.
		dst := filepath.Join(bootstrap, filepath.FromSlash(name))
		if !strings.HasPrefix(dst, bootstrap+string(filepath.Separator)) {
			return secrets, bootstrap, fmt.Errorf("bootstrap file %q is outside the bootstrap directory", name)
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
			return secrets, bootstrap, fmt.Errorf("write bootstrap files: %w", err)
		}
		if err := os.WriteFile(dst, content, 0o600); err != nil {
			return secrets, bootstrap, fmt.Errorf("write bootstrap files: %w", err)
		}
	}
	// A stale result from an earlier install must not be mistaken for this
	// one's.
	_ = os.Remove(filepath.Join(vars, installResultFile))
	return secrets, bootstrap, nil
}

// buildScriptRunArgs is the script-op counterpart to the Terraform tail of
// buildDockerRunArgs.
func buildScriptRunArgs(req *TerraformRequest, secretsPath, bootstrapDir string) ([]string, error) {
	root, err := gen3AdminRoot()
	if err != nil {
		return nil, err
	}
	args := []string{
		"-v", filepath.Join(root, "scripts", "runner") + ":" + containerRepoDir + "/scripts/runner:ro",
		// A direct install deploys the CSOC chart from this checkout.
		"-v", filepath.Join(root, "helm", "csoc") + ":" + containerRepoDir + "/helm/csoc:ro",
	}
	if secretsPath != "" {
		args = append(args, "-e", "SECRETS_FILE="+containerVarsDir+"/"+filepath.Base(secretsPath))
	}
	if bootstrapDir != "" {
		args = append(args, "-e", "BOOTSTRAP_DIR="+containerVarsDir+"/"+filepath.Base(bootstrapDir))
	}
	// install-csoc reports the egress IP it found, finish-csoc the load
	// balancer's address (the records to make when DNS is not in Route 53).
	if bootstrapDir != "" || req.Operation == OpFinishCSOC {
		args = append(args, "-e", "RESULT_FILE="+containerVarsDir+"/"+installResultFile)
	}
	for k, v := range req.installEnv {
		args = append(args, "-e", k+"="+v)
	}
	return args, nil
}

// installResult is what install-csoc reports back.
type installResult struct {
	EgressIP     string `json:"egress_ip"`
	LoadBalancer string `json:"load_balancer"`
}

// takeInstallResult reads and removes the result an install-csoc run left.
func takeInstallResult(varsDir string) *installResult {
	path := filepath.Join(varsDir, installResultFile)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	_ = os.Remove(path)
	var r installResult
	if json.Unmarshal(raw, &r) != nil {
		return &installResult{}
	}
	if ip := net.ParseIP(r.EgressIP); ip == nil || ip.To4() == nil || !validEgressIP.MatchString(r.EgressIP) {
		r.EgressIP = ""
	}
	if !validHostname.MatchString(r.LoadBalancer) {
		r.LoadBalancer = ""
	}
	return &r
}

// gen3AdminRoot finds the checkout the API runs from, which holds the runner
// scripts. GEN3_ADMIN_ROOT overrides it.
func gen3AdminRoot() (string, error) {
	if root := os.Getenv("GEN3_ADMIN_ROOT"); root != "" {
		return root, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "scripts", "runner", "install-csoc.sh")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("cannot find the gen3-admin checkout (scripts/runner); set GEN3_ADMIN_ROOT")
		}
		dir = parent
	}
}
