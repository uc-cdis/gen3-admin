package terraform

import (
	"encoding/json"
	"strings"
	"testing"
)

// joined renders the args the way buildDockerCommand does, so assertions can
// look for whole flags rather than picking through slice indices.
func joined(req *TerraformRequest) string {
	return strings.Join(buildTerraformArgs(req), " ")
}

func TestInitCopiesFromModule(t *testing.T) {
	// The module reference used to be smuggled inside Operation, where it
	// matched no switch case and was silently never fetched.
	req := &TerraformRequest{
		Operation:  OpInit,
		FromModule: "git::github.com/uc-cdis/gen3-terraform.git//examples/csoc?ref=main",
	}

	got := joined(req)
	want := "-from-module=git::github.com/uc-cdis/gen3-terraform.git//examples/csoc?ref=main"
	if !strings.Contains(got, want) {
		t.Errorf("init args = %q, want it to contain %q", got, want)
	}
	if !strings.HasPrefix(got, "init") {
		t.Errorf("init args = %q, want operation to stay a bare %q", got, "init")
	}
}

func TestInitOmitsFromModuleWhenUnset(t *testing.T) {
	got := joined(&TerraformRequest{Operation: OpInit})
	if strings.Contains(got, "-from-module") {
		t.Errorf("init args = %q, want no -from-module when none requested", got)
	}
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

func TestTerraformBinaryIsNamedOnlyForShellEntrypointImages(t *testing.T) {
	// The old check compared against the literal default, so an empty image --
	// the common case -- wrongly took the prepend branch and produced
	// "terraform terraform plan".
	cases := []struct {
		name       string
		image      string
		wantPrefix string
	}{
		{"default image", "", "plan"},
		{"official image", "hashicorp/terraform:latest", "plan"},
		{"official pinned", "hashicorp/terraform:1.9.5", "plan"},
		{"local custom image", "gen3-terraform:latest", "terraform plan"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := joined(&TerraformRequest{Operation: OpPlan, DockerImage: tc.image})
			if !strings.HasPrefix(got, tc.wantPrefix) {
				t.Errorf("args for image %q = %q, want prefix %q", tc.image, got, tc.wantPrefix)
			}
			if strings.HasPrefix(got, "terraform terraform") {
				t.Errorf("args for image %q = %q, want the binary named at most once", tc.image, got)
			}
		})
	}
}

func TestAWSCredentialsBecomeContainerEnv(t *testing.T) {
	// An in-cluster CSOC has no ~/.aws to mount, so explicit credentials are
	// the only way it can reach a target account.
	got := buildAWSEnvFlags(&TerraformRequest{
		AWSRegion: "us-west-2",
		AWSCredentials: &AWSCredentials{
			AccessKeyID:     "AKIAEXAMPLE",
			SecretAccessKey: "secret",
			SessionToken:    "token",
		},
	})

	for _, want := range []string{
		"-e AWS_REGION='us-west-2'",
		"-e AWS_ACCESS_KEY_ID='AKIAEXAMPLE'",
		"-e AWS_SECRET_ACCESS_KEY='secret'",
		"-e AWS_SESSION_TOKEN='token'",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("env flags = %q, want them to contain %q", got, want)
		}
	}
}

func TestAWSEnvOmitsSessionTokenWhenAbsent(t *testing.T) {
	got := buildAWSEnvFlags(&TerraformRequest{
		AWSCredentials: &AWSCredentials{AccessKeyID: "AKIAEXAMPLE", SecretAccessKey: "secret"},
	})
	if strings.Contains(got, "AWS_SESSION_TOKEN") {
		t.Errorf("env flags = %q, want no empty session token for long-lived keys", got)
	}
}

func TestAWSEnvIsEmptyWithoutPerRequestSettings(t *testing.T) {
	// With nothing set the run falls back to the mounted ~/.aws, which is the
	// local-compose path.
	if got := buildAWSEnvFlags(&TerraformRequest{}); got != "" {
		t.Errorf("env flags = %q, want empty so the mounted profile is used", got)
	}
}

func TestCredentialsAreQuotedForTheGeneratedShellScript(t *testing.T) {
	// The flags are interpolated into a shell script, so a value containing
	// shell syntax must not be able to break out of it.
	got := buildAWSEnvFlags(&TerraformRequest{
		AWSCredentials: &AWSCredentials{
			AccessKeyID:     "AKIAEXAMPLE",
			SecretAccessKey: "sec'; touch /tmp/pwned; '",
		},
	})
	if strings.Contains(got, "; touch /tmp/pwned") && !strings.Contains(got, `'\''`) {
		t.Errorf("env flags = %q, want the quote in the secret to be escaped", got)
	}
}

// The frontend sends these fields today; before this change Gin silently
// dropped every one of them.
func TestRequestDecodesFrontendPayload(t *testing.T) {
	payload := `{
	  "operation": "init",
	  "work_dir": "csoc-dev",
	  "runtime": "docker",
	  "docker_image": "gen3-terraform:latest",
	  "state_bucket": "my-state",
	  "state_region": "us-east-1",
	  "state_key": "csoc/dev/terraform.tfstate",
	  "from_module": "git::https://github.com/uc-cdis/gen3-terraform.git//examples/csoc?ref=master",
	  "aws_region": "us-east-1",
	  "aws_profile": "dev",
	  "aws_credentials": {"access_key_id":"AKIA","secret_access_key":"s","session_token":"t"}
	}`

	var req TerraformRequest
	if err := json.Unmarshal([]byte(payload), &req); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if req.StateKey != "csoc/dev/terraform.tfstate" {
		t.Errorf("StateKey = %q, want the per-environment key", req.StateKey)
	}
	if req.FromModule == "" {
		t.Error("FromModule is empty, want the module source")
	}
	if req.AWSRegion != "us-east-1" || req.AWSProfile != "dev" {
		t.Errorf("AWSRegion/AWSProfile = %q/%q, want them populated", req.AWSRegion, req.AWSProfile)
	}
	if req.AWSCredentials == nil || req.AWSCredentials.SessionToken != "t" {
		t.Fatalf("AWSCredentials = %+v, want the session token carried through", req.AWSCredentials)
	}
}
