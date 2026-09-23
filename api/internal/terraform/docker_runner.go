package terraform

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Paths inside the runner container. The work dir holds the Terraform sources
// and is where every command runs; the vars dir is mounted separately so the
// tfvars file can be replaced per run without touching the sources.
const (
	containerWorkDir    = "/workspace/tf"
	containerVarsDir    = "/workspace/tf-vars"
	containerPlanOut    = containerWorkDir + "/tfplan"
	containerModulesDir = "/src"

	// backendOverrideName is written into the vars dir and copied into the work
	// dir by the prelude. Terraform merges *_override.tf files into the module,
	// so this declares an S3 backend even when the module itself has none --
	// without it -backend-config is ignored and state stays on local disk.
	backendOverrideName = "gen3_backend_override.tf"
	backendOverride     = "terraform {\n  backend \"s3\" {}\n}\n"

	// runProfile names the profile in the per-run credentials file.
	runProfile = "gen3-csoc-run"

	LabelWorkDir = "terraform.io/work-dir"
)

// runnerPrelude is the only script the runner executes, and it is a constant.
// Every request value reaches it as an environment variable or a positional
// argument, never by string interpolation, so nothing a client sends is ever
// parsed as shell.
//
//   - Copies the module into the work dir on first init only. `init
//     -from-module` refuses a directory that already holds configuration, so
//     re-running the wizard for an existing environment would otherwise fail.
//   - Installs or removes the backend override to match this run.
//   - Prints the caller identity so the log shows which account is in use.
//   - Hands off to terraform with the remaining arguments.
const runnerPrelude = `set -e
if [ -n "$GEN3_FROM_MODULE" ] && ! ls ./*.tf >/dev/null 2>&1; then
  echo "=== Fetching module $GEN3_FROM_MODULE ==="
  terraform init -input=false -backend=false -from-module="$GEN3_FROM_MODULE"
fi
if [ -f "` + containerVarsDir + `/` + backendOverrideName + `" ]; then
  cp "` + containerVarsDir + `/` + backendOverrideName + `" "./` + backendOverrideName + `"
else
  rm -f "./` + backendOverrideName + `"
fi
if [ -n "$GEN3_SHOW_IDENTITY" ] && command -v aws >/dev/null 2>&1; then
  echo "=== AWS identity ==="
  aws sts get-caller-identity --output text --query Arn || true
fi
exec terraform "$@"
`

var (
	validBucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	validRegion     = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]$`)
	validStateKey   = regexp.MustCompile(`^[A-Za-z0-9_./-]{1,512}$`)
	validProfile    = regexp.MustCompile(`^[A-Za-z0-9_.@+-]{1,128}$`)
	validVarName    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
	validPlanFile   = regexp.MustCompile(`^` + regexp.QuoteMeta(containerWorkDir) + `/[A-Za-z0-9_.-]+$`)
)

var validOperations = map[TerraformOperation]bool{
	OpInit: true, OpPlan: true, OpApply: true, OpDestroy: true, OpOutput: true, OpValidate: true,
}

// validateRequest rejects any field whose value is outside what it could
// legitimately be. The runner no longer goes through a shell, so this is not
// the injection defence on its own, but it stops malformed values from
// reaching terraform, docker, or the S3 API as surprising arguments.
func validateRequest(req *TerraformRequest) error {
	if !validOperations[req.Operation] {
		return fmt.Errorf("unsupported operation %q", req.Operation)
	}
	if req.StateBucket != "" && !validBucketName.MatchString(req.StateBucket) {
		return fmt.Errorf("state_bucket is not a valid S3 bucket name")
	}
	if req.StateRegion != "" && !validRegion.MatchString(req.StateRegion) {
		return fmt.Errorf("state_region is not a valid AWS region")
	}
	if req.AWSRegion != "" && !validRegion.MatchString(req.AWSRegion) {
		return fmt.Errorf("aws_region is not a valid AWS region")
	}
	if req.StateKey != "" && (!validStateKey.MatchString(req.StateKey) || strings.Contains(req.StateKey, "..")) {
		return fmt.Errorf("state_key may only contain letters, digits, and _ . / -")
	}
	if req.AWSProfile != "" && !validProfile.MatchString(req.AWSProfile) {
		return fmt.Errorf("aws_profile is not a valid profile name")
	}
	if req.PlanFile != "" && !validPlanFile.MatchString(req.PlanFile) {
		return fmt.Errorf("plan_file must be a file in %s", containerWorkDir)
	}
	for k := range req.Vars {
		if !validVarName.MatchString(k) {
			return fmt.Errorf("variable name %q is not a valid identifier", k)
		}
	}
	if req.DockerImage != "" && !validImageRef.MatchString(req.DockerImage) {
		return fmt.Errorf("docker_image is not a valid image reference")
	}
	if req.Module != "" {
		if _, ok := moduleSources()[req.Module]; !ok {
			return fmt.Errorf("unknown module %q", req.Module)
		}
	}
	if c := req.AWSCredentials; c != nil && c.AccessKeyID != "" && c.SecretAccessKey == "" {
		return fmt.Errorf("aws_credentials needs both an access key id and a secret access key")
	}
	return nil
}

// moduleSources maps the module names a client may ask for to the source the
// server fetches. Clients pick a name, never a URL, so a request cannot make
// the runner pull and execute arbitrary Terraform.
//
// TERRAFORM_MODULES_DIR points at a local gen3-terraform checkout, mounted
// read-only into the runner; this is the path for testing unpublished module
// changes. CSOC_MODULE_SOURCE overrides the source outright.
func moduleSources() map[string]string {
	csoc := "git::https://github.com/uc-cdis/gen3-terraform.git//examples/csoc?ref=terraform-docker"
	if os.Getenv("TERRAFORM_MODULES_DIR") != "" {
		csoc = containerModulesDir + "/examples/csoc"
	}
	if v := os.Getenv("CSOC_MODULE_SOURCE"); v != "" {
		csoc = v
	}
	return map[string]string{"csoc": csoc}
}

// prepareRunFiles writes the per-run files the container reads from the vars
// dir: the backend override, and the credentials file when explicit
// credentials were supplied. It returns the credentials file path so the
// caller can remove it once the run finishes.
func prepareRunFiles(req *TerraformRequest, executionID string) (credsPath string, err error) {
	varsDir := req.WorkDir + "-vars"
	overridePath := filepath.Join(varsDir, backendOverrideName)
	if req.StateBucket != "" {
		if err := os.WriteFile(overridePath, []byte(backendOverride), 0o640); err != nil {
			return "", fmt.Errorf("write backend override: %w", err)
		}
	} else if err := os.Remove(overridePath); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("remove backend override: %w", err)
	}

	c := req.AWSCredentials
	if c == nil || c.AccessKeyID == "" {
		return "", nil
	}

	// Credentials go in a 0600 file rather than -e flags: flags are visible in
	// the host process list and are kept in `docker inspect` output for as
	// long as the container exists.
	var b strings.Builder
	fmt.Fprintf(&b, "[%s]\naws_access_key_id = %s\naws_secret_access_key = %s\n",
		runProfile, singleLine(c.AccessKeyID), singleLine(c.SecretAccessKey))
	if c.SessionToken != "" {
		fmt.Fprintf(&b, "aws_session_token = %s\n", singleLine(c.SessionToken))
	}
	credsPath = filepath.Join(varsDir, "aws-credentials-"+executionID)
	if err := os.WriteFile(credsPath, []byte(b.String()), 0o600); err != nil {
		return "", fmt.Errorf("write credentials: %w", err)
	}
	return credsPath, nil
}

// singleLine keeps a credential value from adding lines to the ini file.
func singleLine(v string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(strings.TrimSpace(v))
}

// buildDockerRunArgs builds the argv for `docker run`. It is executed
// directly, not through a shell, and the container runs the constant
// runnerPrelude with request values passed as env or positional args.
func buildDockerRunArgs(req *TerraformRequest, executionID, credsPath string) []string {
	homeDir, _ := os.UserHomeDir()
	image := req.DockerImage
	if image == "" {
		image = defaultRunnerImage
	}

	args := []string{
		"run", "-d",
		"--name", containerName(req, executionID),
		"--label", LabelManagedBy + "=" + ManagedByValue,
		"--label", LabelComponent + "=" + ComponentValue,
		"--label", LabelOperation + "=" + string(req.Operation),
		"--label", LabelExecutionID + "=" + executionID,
		"--label", LabelWorkDir + "=" + filepath.Base(req.WorkDir),
		"-v", homeDir + "/.aws:/root/.aws:ro",
		"-v", req.WorkDir + ":" + containerWorkDir + ":rw",
		"-v", req.WorkDir + "-vars:" + containerVarsDir + ":rw",
		"-w", containerWorkDir,
		"-e", "TF_IN_AUTOMATION=1",
		"-e", "TF_INPUT=0",
	}

	if dir := os.Getenv("TERRAFORM_MODULES_DIR"); dir != "" {
		args = append(args, "-v", dir+":"+containerModulesDir+":ro")
	}
	if req.DockerNetwork != "" {
		args = append(args, "--network", req.DockerNetwork)
	}

	if req.Operation == OpInit {
		if src := req.FromModule; src != "" {
			args = append(args, "-e", "GEN3_FROM_MODULE="+src)
		}
		args = append(args, "-e", "GEN3_SHOW_IDENTITY=1")
	}

	args = append(args, awsEnvArgs(req, credsPath)...)

	for k, v := range req.Vars {
		args = append(args, "-e", "TF_VAR_"+k+"="+v)
	}

	args = append(args, "--entrypoint", "/bin/sh", image, "-c", runnerPrelude, "gen3-runner")
	return append(args, buildTerraformArgs(req)...)
}

// awsEnvArgs selects credentials for this run only. Explicit credentials win,
// then an explicitly chosen profile, then the server's own AWS_PROFILE; with
// none of those the mounted ~/.aws default profile applies.
func awsEnvArgs(req *TerraformRequest, credsPath string) []string {
	var args []string
	if req.AWSRegion != "" {
		args = append(args, "-e", "AWS_REGION="+req.AWSRegion, "-e", "AWS_DEFAULT_REGION="+req.AWSRegion)
	}
	switch {
	case credsPath != "":
		args = append(args,
			"-e", "AWS_SHARED_CREDENTIALS_FILE="+containerVarsDir+"/"+filepath.Base(credsPath),
			"-e", "AWS_PROFILE="+runProfile)
	case req.AWSProfile != "":
		args = append(args, "-e", "AWS_PROFILE="+req.AWSProfile)
	case os.Getenv("AWS_PROFILE") != "":
		args = append(args, "-e", "AWS_PROFILE="+os.Getenv("AWS_PROFILE"))
	}
	return args
}

func containerName(req *TerraformRequest, executionID string) string {
	return fmt.Sprintf("tf-%s-%s", strings.ToLower(string(req.Operation)), executionID[:8])
}
