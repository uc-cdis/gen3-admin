package terraform

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/uc-cdis/gen3-admin/internal/environments"
)

// Paths inside the runner container. The work dir holds the Terraform sources
// and is where every command runs; the vars dir is mounted separately so the
// tfvars file can be replaced per run without touching the sources.
const (
	containerWorkDir    = "/workspace/tf"
	containerVarsDir    = "/workspace/tf-vars"
	containerPlanOut    = containerWorkDir + "/tfplan"
	containerModulesDir = "/src"
	containerAWSHostDir = "/root/.aws-host"

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
//   - With a local gen3-terraform checkout (GEN3_LOCAL_MODULES), copies it
//     afresh on every init, and points the copy's gen3-terraform module
//     sources at the checkout too, so unpublished changes to those modules
//     are what runs. Its tf_files are mounted at /src, which the work dir
//     reaches as ../../src.
//   - Installs or removes the backend override to match this run.
//   - Prints the caller identity so the log shows which account is in use.
//   - Hands off to terraform with the remaining arguments. After a successful
//     apply it also writes the outputs to the vars dir for the recorder; they
//     go to a 0600 file rather than the log because some are secrets.
//
// awsHomeCopy gives the run a writable copy of the host's ~/.aws, mounted
// read-only at containerAWSHostDir. The AWS CLI writes refreshed SSO tokens
// and assumed-role credentials back to its cache, and fails on a read-only
// ~/.aws; the copy takes those writes and the host's files are never touched.
const awsHomeCopy = `if [ -d ` + containerAWSHostDir + ` ]; then
  mkdir -p /root/.aws && cp -a ` + containerAWSHostDir + `/. /root/.aws/
fi
`

const runnerPrelude = `set -e
` + awsHomeCopy + `if [ -n "$GEN3_FROM_MODULE" ] && [ -n "$GEN3_LOCAL_MODULES" ]; then
  echo "=== Copying $GEN3_FROM_MODULE, with gen3-terraform modules from the local checkout ==="
  rm -f ./*.tf
  find "$GEN3_FROM_MODULE" -maxdepth 1 -type f -exec cp {} . \;
  sed -i -E 's#"git::(https://)?github\.com/uc-cdis/gen3-terraform\.git//([^"?]+)(\?ref=[^"]*)?"#"../..` + containerModulesDir + `/\2"#' ./*.tf
  grep -h 'source *= *"../..` + containerModulesDir + `/' ./*.tf || true
elif [ -n "$GEN3_FROM_MODULE" ] && ! ls ./*.tf >/dev/null 2>&1; then
  echo "=== Fetching module $GEN3_FROM_MODULE ==="
  terraform init -input=false -backend=false -from-module="$GEN3_FROM_MODULE"
  if [ -n "$GEN3_MODULES_REF" ]; then
    # The example's own gen3-terraform modules, at the example's ref.
    sed -i -E 's#("git::(https://)?github\.com/uc-cdis/gen3-terraform\.git//[^"?]+)(\?ref=[^"]*)?"#\1?ref='"$GEN3_MODULES_REF"'"#' ./*.tf
    grep -h 'source *= *"git::.*gen3-terraform' ./*.tf || true
  fi
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
if [ -n "$GEN3_SAVE_PLAN" ]; then
  # The saved plan holds variable values; keep it owner-only.
  umask 077
  terraform "$@"
  (umask 077; terraform show -json "` + containerPlanOut + `" > "` + containerVarsDir + `/` + planJSONFileName + `") || echo "warning: could not save the plan as JSON"
  if [ -f "` + diagramScript + `" ] && command -v node >/dev/null 2>&1; then
    node "` + diagramScript + `" "` + containerVarsDir + `/` + planJSONFileName + `" "` + containerVarsDir + `/` + diagramJSONFileName + `" || true
  fi
  exit 0
fi
if [ -n "$GEN3_SAVE_OUTPUTS" ]; then
  terraform "$@"
  (umask 077; terraform output -json > "` + containerVarsDir + `/` + outputsFileName + `") || echo "warning: could not save terraform outputs"
  exit 0
fi
exec terraform "$@"
`

var (
	validBucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	validRegion     = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]$`)
	validStateKey   = regexp.MustCompile(`^[A-Za-z0-9_./-]{1,512}$`)
	validProfile    = regexp.MustCompile(`^[A-Za-z0-9_.@+-]{1,128}$`)
	validVarName    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
	validRoleARN    = regexp.MustCompile(`^arn:aws[a-z-]*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$`)
	validPlanFile   = regexp.MustCompile(`^` + regexp.QuoteMeta(containerWorkDir) + `/[A-Za-z0-9_.-]+$`)
)

var validOperations = map[TerraformOperation]bool{
	OpInit: true, OpPlan: true, OpApply: true, OpDestroy: true, OpOutput: true, OpValidate: true,
	OpInstallCSOC: true, OpFinishCSOC: true, OpUninstallCSOC: true,
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
	if req.Environment != "" {
		if !environments.ValidName(req.Environment) {
			return fmt.Errorf("environment is not a valid environment name")
		}
		if req.StateBucket == "" {
			return fmt.Errorf("an environment run needs a state_bucket")
		}
	}
	if req.AWSRoleARN != "" && !validRoleARN.MatchString(req.AWSRoleARN) {
		return fmt.Errorf("aws_role_arn is not a valid IAM role ARN")
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
// The CSOC's Terraform is gen3-terraform's examples/csoc at modulesRef():
// TERRAFORM_MODULES_REF picks a branch or tag, and the gen3-terraform modules
// the example uses are fetched at the same ref (see runnerPrelude).
// TERRAFORM_MODULES_DIR points at a local gen3-terraform checkout, mounted
// read-only into the runner; this is the path for testing unpublished module
// changes. CSOC_MODULE_SOURCE overrides the source outright.
func moduleSources() map[string]string {
	csoc := "git::https://github.com/uc-cdis/gen3-terraform.git//examples/csoc?ref=" + modulesRef()
	if os.Getenv("TERRAFORM_MODULES_DIR") != "" {
		csoc = containerModulesDir + "/examples/csoc"
	}
	if v := os.Getenv("CSOC_MODULE_SOURCE"); v != "" {
		csoc = v
	}
	return map[string]string{"csoc": csoc}
}

// validModulesRef is a git branch or tag name. The ref reaches a sed
// expression in the runner, so nothing outside these characters may.
var validModulesRef = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$`)

const defaultModulesRef = "master"

// modulesRef is the gen3-terraform branch or tag the runner fetches.
func modulesRef() string {
	if v := os.Getenv("TERRAFORM_MODULES_REF"); v != "" && validModulesRef.MatchString(v) && !strings.Contains(v, "..") {
		return v
	}
	return defaultModulesRef
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
	args := dockerRunHeader(req, executionID, credsPath)

	if req.Operation == OpInit {
		if src := req.FromModule; src != "" {
			args = append(args, "-e", "GEN3_FROM_MODULE="+src)
			if os.Getenv("TERRAFORM_MODULES_DIR") != "" && strings.HasPrefix(src, containerModulesDir+"/") {
				args = append(args, "-e", "GEN3_LOCAL_MODULES=1")
			} else if os.Getenv("TERRAFORM_MODULES_REF") != "" {
				args = append(args, "-e", "GEN3_MODULES_REF="+modulesRef())
			}
		}
		args = append(args, "-e", "GEN3_SHOW_IDENTITY=1")
	}
	if req.Operation == OpApply && req.Environment != "" {
		args = append(args, "-e", "GEN3_SAVE_OUTPUTS=1")
	}
	if req.Operation == OpPlan && req.Environment != "" {
		args = append(args, "-e", "GEN3_SAVE_PLAN=1")
		// The diagram script and the parser it uses; without a checkout the
		// plan review still has its list, just no diagram.
		if root, err := gen3AdminRoot(); err == nil {
			args = append(args,
				"-v", filepath.Join(root, "scripts", "runner")+":"+containerRepoDir+"/scripts/runner:ro",
				"-v", filepath.Join(root, "third_party", "tf-arch")+":"+containerRepoDir+"/third_party/tf-arch:ro")
		}
	}
	for k, v := range req.Vars {
		args = append(args, "-e", "TF_VAR_"+k+"="+v)
	}

	args = append(args, "--entrypoint", "/bin/sh", runnerImage(req), "-c", runnerPrelude, "gen3-runner")
	return append(args, buildTerraformArgs(req)...)
}

// buildScriptDockerArgs builds the argv for an install-csoc or finish-csoc
// run, which runs a runner script instead of Terraform.
func buildScriptDockerArgs(req *TerraformRequest, executionID, credsPath, secretsPath, bootstrapDir string) ([]string, error) {
	script, err := buildScriptRunArgs(req, secretsPath, bootstrapDir)
	if err != nil {
		return nil, err
	}
	args := append(dockerRunHeader(req, executionID, credsPath), script...)
	// The script runs as $0 of a constant command that first copies ~/.aws.
	return append(args, "--entrypoint", "/bin/bash", runnerImage(req), "-c", awsHomeCopy+`exec /bin/bash "$0"`, scriptFor(req.Operation)), nil
}

func runnerImage(req *TerraformRequest) string {
	if req.DockerImage != "" {
		return req.DockerImage
	}
	return defaultRunnerImage()
}

// dockerRunHeader is everything up to the image: identity labels, mounts,
// and the run's AWS identity.
func dockerRunHeader(req *TerraformRequest, executionID, credsPath string) []string {
	homeDir, _ := os.UserHomeDir()
	args := []string{
		"run", "-d",
		"--name", containerName(req, executionID),
		"--label", LabelManagedBy + "=" + ManagedByValue,
		"--label", LabelComponent + "=" + ComponentValue,
		"--label", LabelOperation + "=" + string(req.Operation),
		"--label", LabelExecutionID + "=" + executionID,
		"--label", LabelWorkDir + "=" + filepath.Base(req.WorkDir),
		"-v", homeDir + "/.aws:" + containerAWSHostDir + ":ro",
		"-v", req.WorkDir + ":" + containerWorkDir + ":rw",
		"-v", req.WorkDir + "-vars:" + containerVarsDir + ":rw",
		"-w", containerWorkDir,
		"-e", "TF_IN_AUTOMATION=1",
		// Logs are stored and shown as text; colour codes only get in the way.
		"-e", "TF_CLI_ARGS=-no-color",
		"-e", "TF_INPUT=0",
	}
	if dir := os.Getenv("TERRAFORM_MODULES_DIR"); dir != "" {
		args = append(args, "-v", dir+":"+containerModulesDir+":ro")
	}
	if req.DockerNetwork != "" {
		args = append(args, "--network", req.DockerNetwork)
	}
	return append(args, awsEnvArgs(req, credsPath)...)
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
