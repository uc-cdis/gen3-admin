package terraform

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/uc-cdis/gen3-admin/internal/environments"
	"github.com/uc-cdis/gen3-admin/internal/environments/envtest"
)

func goodInstall() *InstallOptions {
	return &InstallOptions{AllowedCIDRs: []string{"203.0.113.7/32"}, AdminPassword: "correct-horse-battery"}
}

func TestInstallOptionsValidation(t *testing.T) {
	o := goodInstall()
	o.AllowedCIDRs = []string{" 203.0.113.9/24 "}
	if err := validateInstallOptions(o); err != nil {
		t.Fatal(err)
	}
	if o.AllowedCIDRs[0] != "203.0.113.0/24" {
		t.Errorf("CIDR not normalised: %q", o.AllowedCIDRs[0])
	}

	bad := map[string]func(*InstallOptions){
		"no cidrs":          func(o *InstallOptions) { o.AllowedCIDRs = nil },
		"open to world":     func(o *InstallOptions) { o.AllowedCIDRs = []string{"0.0.0.0/0"} },
		"not a cidr":        func(o *InstallOptions) { o.AllowedCIDRs = []string{"1.2.3.4"} },
		"ipv6":              func(o *InstallOptions) { o.AllowedCIDRs = []string{"2001:db8::/64"} },
		"short password":    func(o *InstallOptions) { o.AdminPassword = "short" },
		"quote":             func(o *InstallOptions) { o.AdminPassword = `abcdefghijkl"` },
		"single quote":      func(o *InstallOptions) { o.AdminPassword = `abcdefghijkl'` },
		"expansion":         func(o *InstallOptions) { o.AdminPassword = `abcdefghijkl$(id)` },
		"newline":           func(o *InstallOptions) { o.AdminPassword = "abcdefghijkl\nX=1" },
		"bad email":         func(o *InstallOptions) { o.AdminEmail = "x;id@a" },
		"image without tag": func(o *InstallOptions) { o.APIImage = "quay.io/cdis/csoc-api" },
	}
	for name, mutate := range bad {
		o := goodInstall()
		mutate(o)
		if err := validateInstallOptions(o); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func envWithOutputs(t *testing.T, out map[string]string) *environments.Environment {
	t.Helper()
	e := &environments.Environment{
		Name: "dev", Kind: environments.KindCSOC, Region: "us-east-1", Status: environments.StatusApplied,
		Outputs: map[string]json.RawMessage{},
		GitOps:  &environments.GitOps{Owner: "example-org", Repo: "gitops", BaseBranch: "main", AppID: 1, InstallationID: 2, KeySecret: "gen3-csoc/dev/github-app"},
	}
	for k, v := range out {
		b, _ := json.Marshal(v)
		e.Outputs[k] = b
	}
	return e
}

func completeOutputs() map[string]string {
	return map[string]string{
		"cluster_name":              "dev",
		"aws_region":                "us-east-1",
		"vpc_id":                    "vpc-0123456789abcdef0",
		"lb_controller_role_arn":    "arn:aws:iam::111122223333:role/dev-lb-controller",
		"external_secrets_role_arn": "arn:aws:iam::111122223333:role/dev-external-secrets",
		"csoc_api_role_arn":         "arn:aws:iam::111122223333:role/dev-csoc-api",
		"certificate_arn":           "arn:aws:acm:us-east-1:111122223333:certificate/12345678-1234-1234-1234-123456789012",
		"csoc_hostname":             "csoc.example.org",
		"keycloak_hostname":         "keycloak.example.org",
	}
}

func TestFinishInputsFromOutputs(t *testing.T) {
	in, err := scriptInputs(envWithOutputs(t, completeOutputs()), finishChecks)
	if err != nil {
		t.Fatal(err)
	}
	if in["CLUSTER_NAME"] != "dev" || in["CSOC_HOSTNAME"] != "csoc.example.org" {
		t.Errorf("inputs = %v", in)
	}
	if _, ok := in["HOSTED_ZONE_ID"]; ok {
		t.Error("absent optional output became an input")
	}

	missing := completeOutputs()
	delete(missing, "keycloak_hostname")
	if _, err := scriptInputs(envWithOutputs(t, missing), finishChecks); err == nil || !strings.Contains(err.Error(), "keycloak_hostname") {
		t.Errorf("missing output err = %v", err)
	}

	tampered := completeOutputs()
	tampered["csoc_hostname"] = "csoc.example.org; rm -rf /"
	if _, err := scriptInputs(envWithOutputs(t, tampered), finishChecks); err == nil {
		t.Error("an output with shell in it was accepted")
	}
}

func TestPrepareFinishNeedsMergedPR(t *testing.T) {
	e := envWithOutputs(t, completeOutputs())
	e.Status = environments.StatusBootstrapped
	if _, err := prepareFinish(e, &TerraformRequest{StateBucket: "bucket"}); err == nil || !strings.Contains(err.Error(), "merge") {
		t.Errorf("err = %v, want a merge-first error", err)
	}
	e.GitOps.PullRequest = &environments.PullRequest{Number: 1, State: "closed", Merged: true}
	if _, err := prepareFinish(e, &TerraformRequest{StateBucket: "bucket"}); err != nil {
		t.Fatal(err)
	}
	e.Status = environments.StatusApplied
	if _, err := prepareFinish(e, &TerraformRequest{StateBucket: "bucket"}); err == nil {
		t.Error("finish allowed before install-csoc")
	}
}

func TestDirectInstallNeedsNoRepo(t *testing.T) {
	store := environments.NewStore(envtest.NewMemS3(), "bucket")
	ctx := context.Background()
	e := envWithOutputs(t, completeOutputs())
	e.GitOps = nil
	if _, err := store.Save(ctx, e); err != nil {
		t.Fatal(err)
	}
	req := &TerraformRequest{Operation: OpInstallCSOC, StateBucket: "bucket", Install: goodInstall()}
	if err := validateInstallOptions(req.Install); err != nil {
		t.Fatal(err)
	}
	in, err := prepareInstall(ctx, store, e, req)
	if err != nil {
		t.Fatal(err)
	}
	if in["INSTALL_MODE"] != environments.InstallDirect {
		t.Errorf("INSTALL_MODE = %q, want direct", in["INSTALL_MODE"])
	}
	for _, want := range []string{"values/csoc.yaml", "values/external-secrets.yaml", "manifests/keycloak.yaml", "keycloak-operator/kustomization.yaml"} {
		if _, ok := req.installFiles[want]; !ok {
			t.Errorf("direct install is missing %s", want)
		}
	}
	for name := range req.installFiles {
		if strings.HasPrefix(name, "apps/") || name == "root.yaml" || name == "manifests/repo-creds.yaml" {
			t.Errorf("direct install got the GitOps-only file %s", name)
		}
	}
	got, _ := store.Get(ctx, "dev")
	if !got.Install.Direct() {
		t.Errorf("recorded install mode = %q", got.Install.Mode)
	}

	// finish re-renders with the egress IP the install found, and needs no PR.
	got.Status = environments.StatusBootstrapped
	got.Install.EgressIP = "198.51.100.9"
	freq := &TerraformRequest{Operation: OpFinishCSOC, StateBucket: "bucket"}
	fin, err := prepareFinish(got, freq)
	if err != nil {
		t.Fatal(err)
	}
	if fin["INSTALL_MODE"] != environments.InstallDirect {
		t.Errorf("finish INSTALL_MODE = %q", fin["INSTALL_MODE"])
	}
	if !strings.Contains(string(freq.installFiles["values/csoc.yaml"]), "198.51.100.9/32") {
		t.Error("finish did not add the egress IP to the allowlist")
	}
}

func TestScriptFilesKeepTheirDirectories(t *testing.T) {
	work := filepath.Join(t.TempDir(), "w")
	if err := os.MkdirAll(work+"-vars", 0o700); err != nil {
		t.Fatal(err)
	}
	req := &TerraformRequest{Operation: OpFinishCSOC, WorkDir: work,
		installFiles: map[string][]byte{"manifests/keycloak.yaml": []byte("kind: Keycloak\n")}}
	secrets, bootstrap, err := writeScriptFiles(req, "id")
	if err != nil {
		t.Fatal(err)
	}
	if secrets != "" {
		t.Error("finish-csoc got a secrets file")
	}
	if _, err := os.Stat(filepath.Join(bootstrap, "manifests", "keycloak.yaml")); err != nil {
		t.Error(err)
	}
	req.installFiles = map[string][]byte{"../escape.yaml": []byte("x")}
	if _, _, err := writeScriptFiles(req, "id2"); err == nil {
		t.Error("a file outside the bootstrap directory was written")
	}
}

func TestPrepareInstallRendersAndRecords(t *testing.T) {
	store := environments.NewStore(envtest.NewMemS3(), "bucket")
	ctx := context.Background()
	e := envWithOutputs(t, completeOutputs())
	if _, err := store.Save(ctx, e); err != nil {
		t.Fatal(err)
	}
	_, _ = store.Update(ctx, "dev", func(s *environments.Environment) { s.GitOps = e.GitOps })

	req := &TerraformRequest{Operation: OpInstallCSOC, StateBucket: "bucket", Install: goodInstall()}
	req.Install.AdminEmail = "ops@example.org"
	if err := validateInstallOptions(req.Install); err != nil {
		t.Fatal(err)
	}
	in, err := prepareInstall(ctx, store, e, req)
	if err != nil {
		t.Fatal(err)
	}
	if in["SECRET_PREFIX"] != "gen3-csoc/dev/" || in["CLUSTER_NAME"] != "dev" || in["ESO_CHART_VERSION"] == "" {
		t.Errorf("inputs = %v", in)
	}
	for _, name := range []string{"root.yaml", "repo-creds.yaml", "secret-store.yaml", "argocd-values.yaml", "external-secrets-values.yaml"} {
		if len(req.installFiles[name]) == 0 {
			t.Errorf("bootstrap file %s not rendered", name)
		}
	}
	stored, _ := store.Get(ctx, "dev")
	if stored.Install == nil || stored.Install.AdminEmail != "ops@example.org" || len(stored.Install.AllowedCIDRs) != 1 {
		t.Errorf("install settings not recorded: %+v", stored.Install)
	}
	raw, _ := json.Marshal(stored)
	if strings.Contains(string(raw), req.Install.AdminPassword) {
		t.Error("admin password reached the registry")
	}

	noOutput := envWithOutputs(t, completeOutputs())
	delete(noOutput.Outputs, "external_secrets_role_arn")
	if _, err := prepareInstall(ctx, store, noOutput, req); err == nil || !strings.Contains(err.Error(), "external_secrets_role_arn") {
		t.Errorf("err = %v, want missing output", err)
	}
}

func TestScriptDockerArgsKeepThePasswordOutOfArgv(t *testing.T) {
	t.Setenv("GEN3_ADMIN_ROOT", "/repo")
	dir := t.TempDir()
	const id = "00000000-0000-0000-0000-000000000001"
	req := &TerraformRequest{
		Operation:    OpInstallCSOC,
		WorkDir:      dir,
		Install:      goodInstall(),
		installEnv:   map[string]string{"CLUSTER_NAME": "dev"},
		installFiles: map[string][]byte{"root.yaml": []byte("kind: Application\n")},
	}
	if err := os.MkdirAll(dir+"-vars", 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir+"-vars", installResultFile), []byte(`{"egress_ip":"192.0.2.1"}`), 0o600)
	secrets, bootstrap, err := writeScriptFiles(req, id)
	if err != nil {
		t.Fatal(err)
	}
	if fi, _ := os.Stat(secrets); fi.Mode().Perm() != 0o600 {
		t.Errorf("secrets file mode = %v, want 0600", fi.Mode().Perm())
	}
	if b, _ := os.ReadFile(filepath.Join(bootstrap, "root.yaml")); string(b) != "kind: Application\n" {
		t.Errorf("bootstrap root.yaml = %q", b)
	}
	if _, err := os.Stat(filepath.Join(dir+"-vars", installResultFile)); !os.IsNotExist(err) {
		t.Error("a stale install result survived a new install")
	}

	args, err := buildScriptDockerArgs(req, id, "", secrets, bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	if strings.Contains(got, req.Install.AdminPassword) {
		t.Error("admin password is in the docker argv")
	}
	for _, want := range []string{
		"/repo/scripts/runner:/gen3-admin/scripts/runner:ro",
		"CLUSTER_NAME=dev",
		"SECRETS_FILE=/workspace/tf-vars/install-secrets-" + id + ".env",
		"BOOTSTRAP_DIR=/workspace/tf-vars/bootstrap-" + id,
		"RESULT_FILE=/workspace/tf-vars/" + installResultFile,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("args missing %q", want)
		}
	}
	// The script runs as $0 of the constant command that copies ~/.aws.
	if !strings.HasSuffix(got, `exec /bin/bash "$0" /gen3-admin/scripts/runner/install-csoc.sh`) ||
		!strings.Contains(got, "--entrypoint /bin/bash gen3-terraform:latest -c "+awsHomeCopy) {
		t.Errorf("args do not end by running the install script: %q", got)
	}
	if !strings.Contains(got, ".aws:"+containerAWSHostDir+":ro") || strings.Contains(got, ".aws:/root/.aws:") {
		t.Errorf("the host's ~/.aws must be mounted read-only beside the copy: %q", got)
	}
	if strings.Contains(got, "exec terraform") {
		t.Error("install runs the terraform prelude")
	}

	removeCredentials(secrets, bootstrap)
	if _, err := os.Stat(bootstrap); !os.IsNotExist(err) {
		t.Error("bootstrap dir survived the run")
	}
}

func TestFinishArgsHaveNoSecrets(t *testing.T) {
	t.Setenv("GEN3_ADMIN_ROOT", "/repo")
	req := &TerraformRequest{Operation: OpFinishCSOC, WorkDir: t.TempDir(), installEnv: map[string]string{"CLUSTER_NAME": "dev"}}
	secrets, bootstrap, err := writeScriptFiles(req, "id")
	if err != nil || secrets != "" || bootstrap != "" {
		t.Fatalf("finish wrote files: %q %q %v", secrets, bootstrap, err)
	}
	args, err := buildScriptDockerArgs(req, "00000000-0000-0000-0000-000000000002", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	if strings.Contains(got, "SECRETS_FILE") || !strings.HasSuffix(got, "/gen3-admin/scripts/runner/finish-csoc.sh") {
		t.Errorf("finish args = %q", got)
	}
}

func TestTakeInstallResult(t *testing.T) {
	dir := t.TempDir()
	write := func(s string) { _ = os.WriteFile(filepath.Join(dir, installResultFile), []byte(s), 0o600) }
	write(`{"egress_ip":"192.0.2.10"}`)
	if r := takeInstallResult(dir); r == nil || r.EgressIP != "192.0.2.10" {
		t.Errorf("result = %+v", r)
	}
	if takeInstallResult(dir) != nil {
		t.Error("result was not removed after reading")
	}
	for _, bad := range []string{`{"egress_ip":"999.1.1.1"}`, `{"egress_ip":"1.2.3.4/0"}`, `nope`} {
		write(bad)
		if r := takeInstallResult(dir); r == nil || r.EgressIP != "" {
			t.Errorf("%s gave %+v", bad, r)
		}
	}
}

func TestUninstallRunsItsScriptWithNoSecrets(t *testing.T) {
	if !isScriptOp(OpUninstallCSOC) || !validOperations[OpUninstallCSOC] {
		t.Fatal("uninstall-csoc is not a runnable script operation")
	}
	t.Setenv("GEN3_ADMIN_ROOT", "/repo")
	req := &TerraformRequest{Operation: OpUninstallCSOC, WorkDir: t.TempDir(),
		installEnv: map[string]string{"CLUSTER_NAME": "dev", "SECRET_PREFIX": "gen3-csoc/dev/"}}
	secrets, bootstrap, err := writeScriptFiles(req, "id")
	if err != nil || secrets != "" || bootstrap != "" {
		t.Fatalf("uninstall wrote files: %q %q %v", secrets, bootstrap, err)
	}
	args, err := buildScriptDockerArgs(req, "00000000-0000-0000-0000-000000000003", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(args, " ")
	if !strings.HasSuffix(got, "/gen3-admin/scripts/runner/uninstall-csoc.sh") || !strings.Contains(got, "SECRET_PREFIX=gen3-csoc/dev/") {
		t.Errorf("uninstall args = %q", got)
	}
	// The cluster outlives an uninstall; only a destroy removes it.
	if s := environments.StatusAfter(string(OpUninstallCSOC), true); s != environments.StatusApplied {
		t.Errorf("status after uninstall = %q", s)
	}
}
