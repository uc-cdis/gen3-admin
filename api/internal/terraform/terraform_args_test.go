package terraform

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// joined renders the args the way buildDockerCommand does, so assertions can
// look for whole flags rather than picking through slice indices.
func joined(req *TerraformRequest) string {
	return strings.Join(buildTerraformArgs(req), " ")
}

func TestInitPassesBackendConfig(t *testing.T) {
	// Without these the run keeps state inside the container, so there is
	// nothing left to destroy the environment with afterwards.
	req := &TerraformRequest{
		Operation:   OpInit,
		StateBucket: "gen3-tf-state",
		StateKey:    "csoc/dev/terraform.tfstate",
		StateRegion: "us-east-1",
	}

	got := joined(req)
	for _, want := range []string{
		"-backend-config=bucket=gen3-tf-state",
		"-backend-config=key=csoc/dev/terraform.tfstate",
		"-backend-config=region=us-east-1",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("init args = %q, want it to contain %q", got, want)
		}
	}
}

func TestInitSkipsBackendConfigWithoutBucket(t *testing.T) {
	got := joined(&TerraformRequest{Operation: OpInit, StateKey: "csoc/dev/terraform.tfstate"})
	if strings.Contains(got, "-backend-config") {
		t.Errorf("init args = %q, want no backend config when no bucket is set", got)
	}
}

func TestVarFilesResolveToTheMountedVarsDir(t *testing.T) {
	// The tfvars mount and the -var-file flag pointed at two different
	// directories, so Terraform never found the file.
	req := &TerraformRequest{
		Operation: OpPlan,
		VarFiles:  []string{"terraform.tfvars"},
	}

	got := joined(req)
	want := "-var-file=" + containerVarsDir + "/terraform.tfvars"
	if !strings.Contains(got, want) {
		t.Errorf("plan args = %q, want it to contain %q", got, want)
	}
}

func TestPlanWritesPlanWhereApplyCanReadIt(t *testing.T) {
	plan := joined(&TerraformRequest{Operation: OpPlan})
	if !strings.Contains(plan, "-out="+containerPlanOut) {
		t.Fatalf("plan args = %q, want it to save the plan to %q", plan, containerPlanOut)
	}

	// Apply must consume that saved plan, otherwise it re-plans and can apply
	// something the operator never reviewed.
	apply := joined(&TerraformRequest{
		Operation:   OpApply,
		AutoApprove: true,
		PlanFile:    containerPlanOut,
	})
	if !strings.HasSuffix(apply, containerPlanOut) {
		t.Errorf("apply args = %q, want it to end with the saved plan %q", apply, containerPlanOut)
	}
}

func TestApplyWithSavedPlanDoesNotRepeatVarFiles(t *testing.T) {
	// A saved plan already encodes its variables; passing -var-file alongside
	// it is rejected by Terraform.
	got := joined(&TerraformRequest{
		Operation:   OpApply,
		AutoApprove: true,
		PlanFile:    containerPlanOut,
		VarFiles:    []string{"terraform.tfvars"},
	})
	if strings.Contains(got, "-var-file") {
		t.Errorf("apply args = %q, want no -var-file alongside a saved plan", got)
	}
}

func TestApplyWithoutSavedPlanStillPassesVarFiles(t *testing.T) {
	got := joined(&TerraformRequest{
		Operation:   OpApply,
		AutoApprove: true,
		VarFiles:    []string{"terraform.tfvars"},
	})
	if !strings.Contains(got, "-var-file="+containerVarsDir+"/terraform.tfvars") {
		t.Errorf("apply args = %q, want it to pass the var file when no plan was saved", got)
	}
}

func TestTerraformArgsNeverNameTheBinary(t *testing.T) {
	// docker runs `exec terraform "$@"` and the pod spec sets command:
	// ["terraform"]; naming it in the args too produced "terraform terraform".
	for _, op := range []TerraformOperation{OpInit, OpPlan, OpApply, OpDestroy} {
		args := buildTerraformArgs(&TerraformRequest{Operation: op})
		if args[0] != string(op) {
			t.Errorf("%s args = %q, want them to start with the operation", op, args)
		}
	}
}

func TestInitReconfiguresWhenBackendIsSet(t *testing.T) {
	// Without -reconfigure a second init with different backend settings stops
	// to ask about migrating state, which a non-interactive run cannot answer.
	got := joined(&TerraformRequest{Operation: OpInit, StateBucket: "gen3-tf-state"})
	if !strings.Contains(got, "-reconfigure") {
		t.Errorf("init args = %q, want -reconfigure alongside backend config", got)
	}
}

// --- request validation -----------------------------------------------------

func validReq() *TerraformRequest {
	return &TerraformRequest{
		Operation:   OpInit,
		WorkDir:     "csoc-dev",
		Runtime:     RuntimeDocker,
		StateBucket: "elise-tftest",
		StateRegion: "us-east-1",
		StateKey:    "csoc/dev/terraform.tfstate",
		AWSRegion:   "us-east-1",
		Module:      "csoc",
	}
}

func TestValidateAcceptsTheWizardPayload(t *testing.T) {
	if err := validateRequest(validReq()); err != nil {
		t.Fatalf("validateRequest = %v, want the wizard's normal request accepted", err)
	}
}

func TestValidateRejectsHostileValues(t *testing.T) {
	// Each of these reached the host shell unquoted before the runner stopped
	// using one. Validation now rejects them before anything runs.
	cases := map[string]func(r *TerraformRequest){
		"bucket with shell syntax": func(r *TerraformRequest) { r.StateBucket = "x;id" },
		"bucket with quote":        func(r *TerraformRequest) { r.StateBucket = "x'y" },
		"region with shell syntax": func(r *TerraformRequest) { r.StateRegion = "us-east-1;id" },
		"aws region with space":    func(r *TerraformRequest) { r.AWSRegion = "us east 1" },
		"state key traversal":      func(r *TerraformRequest) { r.StateKey = "../other/terraform.tfstate" },
		"state key with space":     func(r *TerraformRequest) { r.StateKey = "csoc/my env/state" },
		"profile with shell":       func(r *TerraformRequest) { r.AWSProfile = "dev$(id)" },
		"var name with =":          func(r *TerraformRequest) { r.Vars = map[string]string{"a=b": "c"} },
		"unknown operation":        func(r *TerraformRequest) { r.Operation = "init -from-module=/etc" },
		"unknown module":           func(r *TerraformRequest) { r.Module = "git::https://evil.example/tf" },
		"plan file outside work":   func(r *TerraformRequest) { r.PlanFile = "/etc/passwd" },
		"image with flag":          func(r *TerraformRequest) { r.DockerImage = "--privileged" },
		"key without secret": func(r *TerraformRequest) {
			r.AWSCredentials = &AWSCredentials{AccessKeyID: "AKIA"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := validReq()
			mutate(r)
			if err := validateRequest(r); err == nil {
				t.Errorf("validateRequest accepted %+v, want it rejected", r)
			}
		})
	}
}

func TestModuleSourceIsChosenByTheServer(t *testing.T) {
	t.Setenv("CSOC_MODULE_SOURCE", "")
	t.Setenv("TERRAFORM_MODULES_DIR", "")
	if got := moduleSources()["csoc"]; !strings.Contains(got, "//examples/csoc?ref=terraform-docker") {
		t.Errorf("default csoc source = %q, want the published terraform-docker ref", got)
	}

	// A local checkout is mounted read-only; the source becomes a path in it.
	t.Setenv("TERRAFORM_MODULES_DIR", "/Users/me/gen3-terraform")
	if got := moduleSources()["csoc"]; got != containerModulesDir+"/examples/csoc" {
		t.Errorf("csoc source with TERRAFORM_MODULES_DIR = %q, want the mounted path", got)
	}

	t.Setenv("CSOC_MODULE_SOURCE", "git::https://example.org/tf.git//csoc?ref=v1")
	if got := moduleSources()["csoc"]; got != "git::https://example.org/tf.git//csoc?ref=v1" {
		t.Errorf("csoc source with CSOC_MODULE_SOURCE = %q, want the override", got)
	}
}

// --- docker argv ------------------------------------------------------------

func dockerArgs(t *testing.T, req *TerraformRequest, credsPath string) []string {
	t.Helper()
	if req.WorkDir == "csoc-dev" {
		req.WorkDir = t.TempDir()
	}
	return buildDockerRunArgs(req, "0123456789abcdef", credsPath)
}

func TestDockerRunsOnlyTheConstantPrelude(t *testing.T) {
	// No request value may appear inside the script the container's shell
	// parses; they travel as env vars or positional args instead.
	req := validReq()
	req.StateBucket = "bucket-with-odd.name"
	req.FromModule = "/src/examples/csoc"
	args := dockerArgs(t, req, "")

	i := indexOf(args, "-c")
	if i < 0 || args[i+1] != runnerPrelude {
		t.Fatalf("args = %q, want -c followed by the constant prelude", args)
	}
	if args[i+2] != "gen3-runner" || args[i+3] != "init" {
		t.Errorf("args after prelude = %q, want $0 then the terraform operation", args[i+2:])
	}
	if !contains(args, "GEN3_FROM_MODULE=/src/examples/csoc") {
		t.Errorf("args = %q, want the module source passed as env", args)
	}
	if !contains(args, "-backend-config=bucket=bucket-with-odd.name") {
		t.Errorf("args = %q, want the bucket as its own argv element", args)
	}
}

func TestDockerRunIsDetached(t *testing.T) {
	// The handler used to block until the whole run finished.
	args := dockerArgs(t, validReq(), "")
	if args[0] != "run" || args[1] != "-d" {
		t.Errorf("args = %q, want `run -d`", args[:2])
	}
}

func TestDockerLabelsTheEnvironment(t *testing.T) {
	req := validReq()
	req.WorkDir = filepath.Join(t.TempDir(), "csoc-workshop")
	args := buildDockerRunArgs(req, "0123456789abcdef", "")
	if !contains(args, LabelWorkDir+"=csoc-workshop") {
		t.Errorf("args = %q, want the work dir label so history can be scoped", args)
	}
}

func TestCredentialsNeverAppearInDockerArgs(t *testing.T) {
	// Command-line values show in the host process list and in docker inspect.
	req := validReq()
	req.AWSCredentials = &AWSCredentials{AccessKeyID: "AKIAEXAMPLE", SecretAccessKey: "s3cr3t", SessionToken: "t0ken"}
	args := strings.Join(dockerArgs(t, req, "/tmp/x/aws-credentials-0123"), " ")
	for _, secret := range []string{"AKIAEXAMPLE", "s3cr3t", "t0ken"} {
		if strings.Contains(args, secret) {
			t.Errorf("docker args contain %q; credentials must only be in the 0600 file", secret)
		}
	}
	if !strings.Contains(args, "AWS_SHARED_CREDENTIALS_FILE="+containerVarsDir+"/aws-credentials-0123") {
		t.Errorf("args = %q, want the credentials file referenced by path", args)
	}
	if !strings.Contains(args, "AWS_PROFILE="+runProfile) {
		t.Errorf("args = %q, want the run profile selected", args)
	}
}

func TestExplicitProfileBeatsServerProfile(t *testing.T) {
	t.Setenv("AWS_PROFILE", "server-default")
	req := validReq()
	req.AWSProfile = "csoc"
	args := dockerArgs(t, req, "")
	if !contains(args, "AWS_PROFILE=csoc") || contains(args, "AWS_PROFILE=server-default") {
		t.Errorf("args = %q, want exactly the requested profile", args)
	}
}

func TestPrepareRunFilesWritesBackendOverrideAndCreds(t *testing.T) {
	req := validReq()
	req.WorkDir = filepath.Join(t.TempDir(), "csoc-dev")
	if err := os.MkdirAll(req.WorkDir+"-vars", 0o755); err != nil {
		t.Fatal(err)
	}
	req.AWSCredentials = &AWSCredentials{AccessKeyID: "AKIA", SecretAccessKey: "sec\nret\n[evil]"}

	creds, err := prepareRunFiles(req, "exec1234")
	if err != nil {
		t.Fatalf("prepareRunFiles: %v", err)
	}

	override, err := os.ReadFile(filepath.Join(req.WorkDir+"-vars", backendOverrideName))
	if err != nil || !strings.Contains(string(override), `backend "s3"`) {
		t.Errorf("backend override = %q (%v), want an s3 backend block", override, err)
	}

	info, err := os.Stat(creds)
	if err != nil {
		t.Fatalf("stat creds: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("creds mode = %v, want 0600", info.Mode().Perm())
	}
	body, _ := os.ReadFile(creds)
	for _, line := range strings.Split(string(body), "\n")[1:] {
		if strings.HasPrefix(line, "[") {
			t.Errorf("creds file = %q, want a newline in a value unable to start a new section", body)
		}
	}

	// Without a bucket the override is removed so state stays local on purpose.
	req.StateBucket = ""
	req.AWSCredentials = nil
	if _, err := prepareRunFiles(req, "exec5678"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(req.WorkDir+"-vars", backendOverrideName)); !os.IsNotExist(err) {
		t.Errorf("backend override still present without a bucket (err=%v)", err)
	}
}

func contains(xs []string, want string) bool { return indexOf(xs, want) >= 0 }

func indexOf(xs []string, want string) int {
	for i, x := range xs {
		if x == want {
			return i
		}
	}
	return -1
}

// This is the body TerraformExecutor sends. Credentials used to arrive in
// camelCase and decode to empty strings, so manual credentials were silently
// replaced by the server's own.
func TestRequestDecodesFrontendPayload(t *testing.T) {
	payload := `{
	  "operation": "init",
	  "work_dir": "csoc-dev",
	  "runtime": "docker",
	  "docker_image": "gen3-terraform:latest",
	  "state_bucket": "my-state",
	  "state_region": "us-east-1",
	  "state_key": "csoc/dev/terraform.tfstate",
	  "module": "csoc",
	  "aws_region": "us-east-1",
	  "aws_profile": "dev",
	  "aws_credentials": {"access_key_id":"AKIA","secret_access_key":"s","session_token":"t"}
	}`

	var req TerraformRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if req.StateKey != "csoc/dev/terraform.tfstate" || req.Module != "csoc" {
		t.Errorf("StateKey/Module = %q/%q, want them populated", req.StateKey, req.Module)
	}
	if req.AWSRegion != "us-east-1" || req.AWSProfile != "dev" {
		t.Errorf("AWSRegion/AWSProfile = %q/%q, want them populated", req.AWSRegion, req.AWSProfile)
	}
	if req.AWSCredentials == nil || req.AWSCredentials.AccessKeyID != "AKIA" || req.AWSCredentials.SessionToken != "t" {
		t.Fatalf("AWSCredentials = %+v, want every field carried through", req.AWSCredentials)
	}
}

func TestClientCannotSupplyAModuleURL(t *testing.T) {
	var req TerraformRequest
	_ = json.Unmarshal([]byte(`{"from_module":"git::https://evil.example/tf"}`), &req)
	if req.FromModule != "" {
		t.Errorf("FromModule = %q, want it settable only by the server", req.FromModule)
	}
}
