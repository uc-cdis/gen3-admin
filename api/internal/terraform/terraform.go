package terraform

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
)

type RuntimeType string

const (
	RuntimeDocker RuntimeType = "docker"
	RuntimePod    RuntimeType = "pod"
)

type TerraformOperation string

const (
	OpInit     TerraformOperation = "init"
	OpPlan     TerraformOperation = "plan"
	OpApply    TerraformOperation = "apply"
	OpDestroy  TerraformOperation = "destroy"
	OpOutput   TerraformOperation = "output"
	OpValidate TerraformOperation = "validate"
)

type ExecutionStatus string

const (
	StatusRunning  ExecutionStatus = "running"
	StatusComplete ExecutionStatus = "complete"
	StatusError    ExecutionStatus = "error"
	StatusUnknown  ExecutionStatus = "unknown"
)

// AWSCredentials carries short-lived credentials for a single run. These come
// either from the operator (manual entry) or from assuming a role in a target
// account, and are passed to the runner as environment variables rather than
// being written to disk.
type AWSCredentials struct {
	AccessKeyID     string `json:"access_key_id,omitempty"`
	SecretAccessKey string `json:"secret_access_key,omitempty"`
	SessionToken    string `json:"session_token,omitempty"`
}

type TerraformRequest struct {
	Operation   TerraformOperation `json:"operation" binding:"required"`
	WorkDir     string             `json:"work_dir" binding:"required"`
	Runtime     RuntimeType        `json:"runtime" binding:"required"`
	VarFiles    []string           `json:"var_files,omitempty"`
	Vars        map[string]string  `json:"vars,omitempty"`
	AutoApprove bool               `json:"auto_approve,omitempty"`

	// State configuration
	StateBucket string `json:"state_bucket,omitempty"`
	StateRegion string `json:"state_region,omitempty"`

	// Module names the module to copy into a fresh work dir on init. Clients
	// choose a name; the server maps it to a source (see moduleSources), so a
	// request cannot point the runner at arbitrary Terraform.
	Module string `json:"module,omitempty"`

	// FromModule is the resolved source for Module. Server-side only.
	FromModule string `json:"-"`

	// AWS credentials. Docker mode previously relied solely on the server's
	// mounted ~/.aws, which does not exist when CSOC itself runs in-cluster.
	AWSRegion      string          `json:"aws_region,omitempty"`
	AWSProfile     string          `json:"aws_profile,omitempty"`
	AWSCredentials *AWSCredentials `json:"aws_credentials,omitempty"`

	// StateKey is the object key for the S3 backend, one per environment.
	StateKey string `json:"state_key,omitempty"`

	// PlanFile, when set on an apply, applies a previously saved plan instead
	// of re-planning.
	PlanFile string `json:"plan_file,omitempty"`

	// Docker specific
	DockerImage          string `json:"docker_image,omitempty"`
	DockerNetwork        string `json:"docker_network,omitempty"`
	DockerTFVars         string `json:"tfvars,omitempty"`
	DockerTFVarsFileName string `json:"tfvars_file_name,omitempty"`

	// Kubernetes specific
	Namespace      string            `json:"namespace,omitempty"`
	PodImage       string            `json:"pod_image,omitempty"`
	ServiceAccount string            `json:"service_account,omitempty"`
	SecretName     string            `json:"secret_name,omitempty"`
	Labels         map[string]string `json:"labels,omitempty"`
}

type TerraformExecution struct {
	ID        string             `json:"id"`
	Operation TerraformOperation `json:"operation"`
	WorkDir   string             `json:"work_dir"`
	Runtime   RuntimeType        `json:"runtime"`
	Status    ExecutionStatus    `json:"status"`
	Output    []string           `json:"output,omitempty"`
	Error     string             `json:"error,omitempty"`
	StartTime time.Time          `json:"start_time"`
	EndTime   *time.Time         `json:"end_time,omitempty"`

	ContainerName string            `json:"container_name,omitempty"`
	PodName       string            `json:"pod_name,omitempty"`
	Namespace     string            `json:"namespace,omitempty"`
	Labels        map[string]string `json:"labels,omitempty"`
}

type BootstrapAWSSecretRequest struct {
	SecretName     string `json:"secret_name"`
	Namespace      string `json:"namespace"`
	AWSAccessKeyID string `json:"aws_access_key_id" binding:"required"`
	AWSSecretKey   string `json:"aws_secret_access_key" binding:"required"`
	AWSRoleARN     string `json:"aws_role_arn,omitempty"`
	StateBucket    string `json:"state_bucket" binding:"required"`
	StateRegion    string `json:"state_region" binding:"required"`
}

const (
	LabelManagedBy   = "app.kubernetes.io/managed-by"
	LabelComponent   = "app.kubernetes.io/component"
	LabelOperation   = "terraform.io/operation"
	LabelExecutionID = "terraform.io/execution-id"
	ManagedByValue   = "gen3-admin"
	ComponentValue   = "terraform-runner"
)

func ensureTerraformNamespace(namespace string) error {
	cmd := exec.Command("kubectl", "get", "namespace", namespace)
	if err := cmd.Run(); err != nil {
		createCmd := exec.Command("kubectl", "create", "namespace", namespace)
		if err := createCmd.Run(); err != nil {
			return fmt.Errorf("failed to create namespace %s: %w", namespace, err)
		}
	}
	return nil
}

func buildKubectlCommand(req *TerraformRequest, executionID string) (*exec.Cmd, []byte, error) {
	podName := fmt.Sprintf("tf-%s-%s", strings.ToLower(string(req.Operation)), executionID[:8])
	image := req.PodImage
	if image == "" {
		image = "hashicorp/terraform:latest"
	}

	namespace := req.Namespace
	if namespace == "" {
		namespace = "terraform"
	}

	secretName := req.SecretName
	if secretName == "" {
		secretName = "terraform-aws-credentials"
	}

	if err := ensureTerraformNamespace(namespace); err != nil {
		return nil, nil, err
	}

	labels := map[string]string{
		LabelManagedBy:   ManagedByValue,
		LabelComponent:   ComponentValue,
		LabelOperation:   string(req.Operation),
		LabelExecutionID: executionID,
	}

	for k, v := range req.Labels {
		labels[k] = v
	}

	podSpecJSON, err := buildKubectlPodSpec(req, executionID, podName, image, namespace, secretName, labels)
	if err != nil {
		return nil, nil, err
	}

	cmd := exec.Command("kubectl", "apply", "-f", "-")
	cmd.Stdin = bytes.NewReader(podSpecJSON)

	return cmd, podSpecJSON, nil
}

func buildTerraformArgs(req *TerraformRequest) []string {
	// The binary is never named here: docker runs it via runnerPrelude's
	// `exec terraform "$@"`, and the pod spec sets command: ["terraform"].
	// Naming it in the args as well is what produced "terraform terraform".
	args := []string{string(req.Operation)}

	varFileArgs := func() []string {
		var out []string
		for _, varFile := range req.VarFiles {
			out = append(out, "-var-file="+containerVarsDir+"/"+filepath.Base(varFile))
		}
		return out
	}

	switch req.Operation {
	case OpInit:
		// The module itself is copied in by runnerPrelude, which skips the copy
		// when the work dir is already populated.
		//
		// Backend settings are supplied as -backend-config so the same sources
		// can be initialised against a different state key per environment.
		// -reconfigure makes a re-run adopt the current settings instead of
		// stopping to ask whether to migrate state from the previous ones.
		if backend := buildBackendConfigArgs(req); len(backend) > 0 {
			args = append(args, "-reconfigure")
			args = append(args, backend...)
		}
	case OpPlan:
		args = append(args, varFileArgs()...)
		args = append(args, "-out="+containerPlanOut)
	case OpApply:
		// Apply the plan that was reviewed, rather than re-planning and
		// potentially applying something the operator never saw. A saved plan
		// already encodes its variables, so -var-file must not be repeated.
		if req.PlanFile != "" {
			if req.AutoApprove {
				args = append(args, "-auto-approve")
			}
			args = append(args, req.PlanFile)
			break
		}
		if req.AutoApprove {
			args = append(args, "-auto-approve")
		}
		args = append(args, varFileArgs()...)
	case OpDestroy:
		if req.AutoApprove {
			args = append(args, "-auto-approve")
		}
		args = append(args, varFileArgs()...)
	case OpOutput:
		args = append(args, "-json")
	case OpValidate:
		// No additional args needed
	}

	return args
}

// buildBackendConfigArgs turns the request's state settings into -backend-config
// flags. Without these Terraform keeps state inside the container, which is
// discarded when the run ends, leaving nothing to destroy later.
func buildBackendConfigArgs(req *TerraformRequest) []string {
	if req.StateBucket == "" {
		return nil
	}
	args := []string{"-backend-config=bucket=" + req.StateBucket}
	if req.StateKey != "" {
		args = append(args, "-backend-config=key="+req.StateKey)
	}
	if req.StateRegion != "" {
		args = append(args, "-backend-config=region="+req.StateRegion)
	}
	return args
}

func queryDockerExecutions() ([]*TerraformExecution, error) {
	cmd := exec.Command("docker", "ps", "-a",
		"--filter", fmt.Sprintf("label=%s=%s", LabelManagedBy, ManagedByValue),
		"--format", "{{json .}}")

	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to query docker containers: %w", err)
	}

	var executions []*TerraformExecution
	scanner := bufio.NewScanner(&out)
	for scanner.Scan() {
		var container struct {
			ID      string `json:"ID"`
			Names   string `json:"Names"`
			Status  string `json:"Status"`
			Labels  string `json:"Labels"`
			Created string `json:"CreatedAt"`
		}

		if err := json.Unmarshal(scanner.Bytes(), &container); err != nil {
			continue
		}

		labels := parseDockerLabels(container.Labels)
		executionID := labels[LabelExecutionID]
		operation := TerraformOperation(labels[LabelOperation])

		status := StatusUnknown
		if strings.Contains(container.Status, "Up") {
			status = StatusRunning
		} else if strings.Contains(container.Status, "Exited (0)") {
			status = StatusComplete
		} else {
			status = StatusError
		}

		startTime, _ := time.Parse("2006-01-02 15:04:05 -0700 MST", container.Created)

		executions = append(executions, &TerraformExecution{
			ID:            executionID,
			Operation:     operation,
			WorkDir:       labels[LabelWorkDir],
			Runtime:       RuntimeDocker,
			Status:        status,
			ContainerName: container.Names,
			StartTime:     startTime,
			Labels:        labels,
		})
	}

	return executions, nil
}

func queryKubernetesPods(namespace string) ([]*TerraformExecution, error) {
	labelSelector := fmt.Sprintf("%s=%s,%s=%s", LabelManagedBy, ManagedByValue, LabelComponent, ComponentValue)

	args := []string{
		"get", "pods",
		"-l", labelSelector,
		"-o", "json",
	}

	if namespace != "" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}

	cmd := exec.Command("kubectl", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to query kubernetes pods: %w", err)
	}

	var podList struct {
		Items []struct {
			Metadata struct {
				Name              string            `json:"name"`
				Namespace         string            `json:"namespace"`
				Labels            map[string]string `json:"labels"`
				CreationTimestamp time.Time         `json:"creationTimestamp"`
			} `json:"metadata"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}

	if err := json.Unmarshal(out.Bytes(), &podList); err != nil {
		return nil, fmt.Errorf("failed to parse pod list: %w", err)
	}

	var executions []*TerraformExecution
	for _, pod := range podList.Items {
		executionID := pod.Metadata.Labels[LabelExecutionID]
		operation := TerraformOperation(pod.Metadata.Labels[LabelOperation])

		status := StatusUnknown
		switch pod.Status.Phase {
		case "Running":
			status = StatusRunning
		case "Succeeded":
			status = StatusComplete
		case "Failed":
			status = StatusError
		}

		executions = append(executions, &TerraformExecution{
			ID:        executionID,
			Operation: operation,
			Runtime:   RuntimePod,
			Status:    status,
			PodName:   pod.Metadata.Name,
			Namespace: pod.Metadata.Namespace,
			StartTime: pod.Metadata.CreationTimestamp,
			Labels:    pod.Metadata.Labels,
		})
	}

	return executions, nil
}

func parseDockerLabels(labelStr string) map[string]string {
	labels := make(map[string]string)
	pairs := strings.Split(labelStr, ",")
	for _, pair := range pairs {
		kv := strings.SplitN(pair, "=", 2)
		if len(kv) == 2 {
			labels[kv[0]] = kv[1]
		}
	}
	return labels
}

// terraformRoot is the only directory tree the terraform runner will read or
// write. Overridable so a deployment can point it at a real volume.
func terraformRoot() string {
	if root := os.Getenv("TERRAFORM_WORK_ROOT"); root != "" {
		return root
	}
	return "/tmp/gen3-terraform"
}

// validWorkDirName matches a single path segment: no separators, no dots, so
// neither traversal nor shell metacharacters can survive it.
// defaultRunnerImage is built locally by scripts/build-terraform-image.sh and
// is never pushed; docker resolves local images first.
const defaultRunnerImage = "gen3-terraform:latest"

// validImageRef allows a plain [registry/]name[:tag|@digest] reference and
// nothing that could be read as another docker argument -- in particular it
// may not start with "-", or docker would parse it as a flag.
var validImageRef = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9._-]+)?(@sha256:[a-f0-9]{64})?$`)

var validWorkDirName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// resolveWorkDir maps a requested working directory onto a single directory
// inside terraformRoot().
//
// The raw value used to be taken verbatim: it is passed to os.MkdirAll and
// os.WriteFile, and interpolated into the `sh -c` docker script, so an absolute
// path or a `..` segment meant arbitrary filesystem writes and a caller could
// break out of the script with shell metacharacters. Accepting only a bare name
// closes both.
func resolveWorkDir(requested string) (string, error) {
	root := terraformRoot()

	requested = strings.TrimSpace(requested)
	if requested == "" {
		return root, nil
	}

	// Tolerate a caller echoing the root back, which the UI does today.
	if requested == root {
		return root, nil
	}
	if trimmed := strings.TrimPrefix(requested, root+"/"); trimmed != requested {
		requested = trimmed
	}

	if !validWorkDirName.MatchString(requested) {
		return "", fmt.Errorf("work_dir must be a single name matching [A-Za-z0-9_-]{1,64}")
	}
	return filepath.Join(root, requested), nil
}

// safeTFVarsName validates the tfvars filename. It is joined onto the work dir
// and also passed to terraform as -var-file, so it must stay a single segment:
// filepath.Join cleans a path but does not confine it, and "../../etc/x" would
// otherwise escape.
func safeTFVarsName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "terraform.tfvars", nil
	}
	if name != filepath.Base(name) || name == "." || name == ".." ||
		strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("tfvars_file_name must be a bare filename")
	}
	if !strings.HasSuffix(name, ".tfvars") && !strings.HasSuffix(name, ".tfvars.json") {
		return "", fmt.Errorf("tfvars_file_name must end in .tfvars or .tfvars.json")
	}
	return name, nil
}

// HandleCheckRunnerImage reports whether the runner image is present locally.
// The image is built rather than pulled, so a missing one otherwise surfaces
// mid-run as an opaque docker error; the wizard uses this to show the build
// command up front instead.
func HandleCheckRunnerImage() gin.HandlerFunc {
	return func(c *gin.Context) {
		image := c.Query("image")
		if image == "" {
			image = defaultRunnerImage
		}

		// Reject anything that is not a plain image reference: the value is
		// passed to docker, and the same care is taken with work dirs.
		if !validImageRef.MatchString(image) {
			c.JSON(400, gin.H{"error": "invalid image reference"})
			return
		}

		cmd := exec.Command("docker", "image", "inspect", image)
		if err := cmd.Run(); err != nil {
			c.JSON(200, gin.H{
				"image":         image,
				"present":       false,
				"build_command": "./scripts/build-terraform-image.sh",
			})
			return
		}
		c.JSON(200, gin.H{"image": image, "present": true})
	}
}

func HandleTerraformExecute() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req TerraformRequest
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if err := validateRequest(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if req.Module != "" {
			req.FromModule = moduleSources()[req.Module]
		}

		// WorkDir comes from the request body and becomes a host bind mount,
		// so it is confined to a single directory under the runtime root
		// rather than taken as given.
		workDir, err := resolveWorkDir(req.WorkDir)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		req.WorkDir = workDir

		if err := os.MkdirAll(req.WorkDir, 0o755); err != nil {
			c.JSON(500, gin.H{"error": "failed to create work dir"})
			return
		}
		if err := os.MkdirAll(req.WorkDir+"-vars", 0o755); err != nil {
			c.JSON(500, gin.H{"error": "failed to create work dir"})
			return
		}

		// write tfvars if sent from frontend
		if strings.TrimSpace(req.DockerTFVars) != "" {
			name, err := safeTFVarsName(req.DockerTFVarsFileName)
			if err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			// safeTFVarsName already rejects anything but a bare filename;
			// filepath.Base makes that confinement local to this statement and
			// is what static analysis recognises as the sanitizer.
			tfvarsPath := filepath.Join(req.WorkDir+"-vars", filepath.Base(name))
			if err := os.WriteFile(tfvarsPath, []byte(req.DockerTFVars), 0o640); err != nil {
				log.Error().
					Err(err).
					Msg("failed to write tfvars")
				c.JSON(500, gin.H{"error": "failed to write tfvars"})
				return
			}
			// tell the arg builder to use it
			req.VarFiles = append(req.VarFiles, name)
		}

		executionID := uuid.New().String()

		switch req.Runtime {
		case RuntimeDocker:
			startDockerExecution(c, &req, executionID)
		case RuntimePod:
			startPodExecution(c, &req, executionID)
		default:
			c.JSON(400, gin.H{"error": "Invalid runtime type"})
		}
	}
}

// startDockerExecution starts the run detached and responds as soon as the
// container exists. It used to block the request until the whole run
// finished, which for an apply meant holding the HTTP request open for the
// better part of an hour with no execution ID for the UI to follow.
func startDockerExecution(c *gin.Context, req *TerraformRequest, executionID string) {
	credsPath, err := prepareRunFiles(req, executionID)
	if err != nil {
		log.Error().Err(err).Str("execution_id", executionID).Msg("failed to prepare run files")
		c.JSON(500, gin.H{"error": "failed to prepare run"})
		return
	}

	// The argv is never logged: it is safe to print today, but a future flag
	// carrying a secret would leak silently. Log what identifies the run.
	log.Info().
		Str("execution_id", executionID).
		Str("operation", string(req.Operation)).
		Str("work_dir", filepath.Base(req.WorkDir)).
		Msg("starting terraform execution")

	out, err := exec.Command("docker", buildDockerRunArgs(req, executionID, credsPath)...).CombinedOutput()
	if err != nil {
		removeCredentials(credsPath)
		log.Error().Err(err).Str("execution_id", executionID).Str("output", string(out)).
			Msg("terraform container failed to start")
		c.JSON(500, gin.H{
			"id":      executionID,
			"message": "Terraform execution failed to start",
			"error":   strings.TrimSpace(string(out)),
		})
		return
	}

	// The credentials file must outlive the container's start, since
	// terraform reads it throughout the run, but not the run itself.
	if credsPath != "" {
		name := containerName(req, executionID)
		go func() {
			_ = exec.Command("docker", "wait", name).Run()
			removeCredentials(credsPath)
		}()
	}

	c.JSON(202, gin.H{
		"id":      executionID,
		"message": fmt.Sprintf("Terraform %s execution started", req.Operation),
		"runtime": req.Runtime,
	})
}

func removeCredentials(path string) {
	if path == "" {
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Error().Err(err).Msg("failed to remove run credentials file")
	}
}

// startPodExecution applies the pod spec and waits briefly for it to appear.
func startPodExecution(c *gin.Context, req *TerraformRequest, executionID string) {
	if err := checkAWSSecretExists(req.Namespace, req.SecretName); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	cmd, _, err := buildKubectlCommand(req, executionID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		c.JSON(500, gin.H{
			"id":      executionID,
			"message": "Terraform execution failed to start",
			"error":   strings.TrimSpace(string(out)),
		})
		return
	}

	c.JSON(202, gin.H{
		"id":      executionID,
		"message": fmt.Sprintf("Terraform %s execution started", req.Operation),
		"runtime": req.Runtime,
	})
}

func HandleGetTerraformExecution() gin.HandlerFunc {
	return func(c *gin.Context) {
		execID := c.Param("id")

		dockerExecs, _ := queryDockerExecutions()
		k8sExecs, _ := queryKubernetesPods("")
		allExecs := append(dockerExecs, k8sExecs...)

		for _, exec := range allExecs {
			if exec.ID == execID {
				status := 200
				switch exec.Status {
				case StatusRunning:
					status = 202
				case StatusError:
					status = 500
				}
				c.JSON(status, exec)
				return
			}
		}

		c.JSON(404, gin.H{"error": "Execution not found"})
	}
}

func HandleListTerraformExecutions() gin.HandlerFunc {
	return func(c *gin.Context) {
		dockerExecs, dockerErr := queryDockerExecutions()
		k8sExecs, k8sErr := queryKubernetesPods("")

		if dockerErr != nil && k8sErr != nil {
			c.JSON(500, gin.H{"error": "Failed to query executions"})
			return
		}

		allExecs := append(dockerExecs, k8sExecs...)

		// Scope to one environment when asked, so the wizard shows that
		// environment's runs rather than every run on the host.
		if wd := c.Query("work_dir"); wd != "" {
			scoped := allExecs[:0]
			for _, e := range allExecs {
				if e.WorkDir == wd {
					scoped = append(scoped, e)
				}
			}
			allExecs = scoped
		}

		sort.Slice(allExecs, func(i, j int) bool {
			return allExecs[i].StartTime.After(allExecs[j].StartTime)
		})

		c.JSON(200, allExecs)
	}
}

func waitForPodReady(ctx context.Context, podName, namespace string) error {
	timeout := time.After(5 * time.Minute)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout:
			return fmt.Errorf("timeout waiting for pod to be ready")
		case <-ticker.C:
			cmd := exec.Command("kubectl", "get", "pod", podName, "-n", namespace, "-o", "json")
			var out bytes.Buffer
			cmd.Stdout = &out

			if err := cmd.Run(); err != nil {
				continue
			}

			var pod struct {
				Status struct {
					Phase             string `json:"phase"`
					ContainerStatuses []struct {
						Name  string `json:"name"`
						Ready bool   `json:"ready"`
					} `json:"containerStatuses"`
					InitContainerStatuses []struct {
						Name  string `json:"name"`
						State struct {
							Terminated *struct {
								ExitCode int `json:"exitCode"`
							} `json:"terminated"`
						} `json:"state"`
					} `json:"initContainerStatuses"`
				} `json:"status"`
			}

			if err := json.Unmarshal(out.Bytes(), &pod); err != nil {
				continue
			}

			// // Check if pod failed
			// if pod.Status.Phase == "Failed" {
			// 	return fmt.Errorf("pod failed")
			// }

			// Check init containers completed successfully
			allInitsDone := true
			for _, initContainer := range pod.Status.InitContainerStatuses {
				if initContainer.State.Terminated == nil {
					allInitsDone = false
					break
				}
				if initContainer.State.Terminated.ExitCode != 0 {
					return fmt.Errorf("init container %s failed with exit code %d",
						initContainer.Name, initContainer.State.Terminated.ExitCode)
				}
			}

			// Check main container is running
			if allInitsDone && (pod.Status.Phase == "Running" || pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed") {
				for _, container := range pod.Status.ContainerStatuses {
					if container.Name == "terraform" {
						return nil
					}
				}
			}
		}
	}
}

func HandleStreamTerraformExecution() gin.HandlerFunc {
	return func(c *gin.Context) {
		execID := c.Param("id")

		dockerExecs, _ := queryDockerExecutions()
		k8sExecs, _ := queryKubernetesPods("")
		allExecs := append(dockerExecs, k8sExecs...)

		var execution *TerraformExecution
		for _, e := range allExecs {
			if e.ID == execID {
				execution = e
				break
			}
		}

		if execution == nil {
			c.JSON(404, gin.H{"error": "Execution not found"})
			return
		}

		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("Connection", "keep-alive")
		c.Writer.Flush()

		ctx := c.Request.Context()

		// Wait for pod to be ready if using Kubernetes
		if execution.Runtime == RuntimePod {
			c.SSEvent("message", "Waiting for pod to be ready...")
			c.Writer.Flush()

			if err := waitForPodReady(ctx, execution.PodName, execution.Namespace); err != nil {
				c.SSEvent("failed", fmt.Sprintf("Pod failed to become ready: %v", err))
				c.Writer.Flush()
				return
			}

			c.SSEvent("message", "Pod is ready, streaming logs...")
			c.Writer.Flush()
		}

		var cmd *exec.Cmd
		if execution.Runtime == RuntimeDocker {
			cmd = exec.CommandContext(ctx, "docker", "logs", "-f", execution.ContainerName)
		} else {
			cmd = exec.CommandContext(ctx, "kubectl", "logs", "-f", execution.PodName, "-n", execution.Namespace, "-c", "terraform")
		}

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			c.SSEvent("failed", err.Error())
			c.Writer.Flush()
			return
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			c.SSEvent("failed", err.Error())
			c.Writer.Flush()
			return
		}
		if err := cmd.Start(); err != nil {
			c.SSEvent("failed", err.Error())
			c.Writer.Flush()
			return
		}

		// Both pipes feed one channel so only this goroutine writes to the
		// response; two goroutines writing SSE concurrently was a data race.
		//
		// Terraform writes warnings and progress to stderr, so stderr lines are
		// ordinary log lines. Ending the run on the first one is what made the
		// UI report failure while the run was still going.
		lines := make(chan string, 256)
		var readers sync.WaitGroup
		for _, pipe := range []io.Reader{stdout, stderr} {
			readers.Add(1)
			go func(r io.Reader) {
				defer readers.Done()
				scanner := bufio.NewScanner(r)
				scanner.Buffer(make([]byte, 64*1024), 1024*1024)
				for scanner.Scan() {
					lines <- scanner.Text()
				}
			}(pipe)
		}
		go func() {
			readers.Wait()
			close(lines)
		}()

		for line := range lines {
			if ctx.Err() != nil {
				continue // drain so the readers can exit
			}
			c.SSEvent("message", line)
			c.Writer.Flush()
		}
		_ = cmd.Wait()

		if ctx.Err() != nil {
			return
		}

		// Report how the run actually ended. "done" used to be sent whatever
		// the exit code, so a failed apply showed as a success.
		exitCode, err := executionExitCode(execution)
		if err != nil {
			c.SSEvent("failed", fmt.Sprintf("could not determine exit status: %v", err))
			c.Writer.Flush()
			return
		}
		payload, _ := json.Marshal(gin.H{"exit_code": exitCode})
		c.SSEvent("done", string(payload))
		c.Writer.Flush()
	}
}

// executionExitCode reads the exit code of a finished run.
func executionExitCode(e *TerraformExecution) (int, error) {
	var cmd *exec.Cmd
	if e.Runtime == RuntimeDocker {
		cmd = exec.Command("docker", "inspect", "-f", "{{.State.ExitCode}}", e.ContainerName)
	} else {
		cmd = exec.Command("kubectl", "get", "pod", e.PodName, "-n", e.Namespace, "-o",
			`jsonpath={.status.containerStatuses[?(@.name=="terraform")].state.terminated.exitCode}`)
	}
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}
	code, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0, fmt.Errorf("unexpected exit status %q", strings.TrimSpace(string(out)))
	}
	return code, nil
}

func HandleTerminateTerraform() gin.HandlerFunc {
	return func(c *gin.Context) {
		execID := c.Param("id")

		dockerExecs, _ := queryDockerExecutions()
		k8sExecs, _ := queryKubernetesPods("")
		allExecs := append(dockerExecs, k8sExecs...)

		var execution *TerraformExecution
		for _, e := range allExecs {
			if e.ID == execID {
				execution = e
				break
			}
		}

		if execution == nil {
			c.JSON(404, gin.H{"error": "Execution not found"})
			return
		}

		var cmd *exec.Cmd
		if execution.Runtime == RuntimeDocker {
			cmd = exec.Command("docker", "stop", execution.ContainerName)
		} else {
			cmd = exec.Command("kubectl", "delete", "pod", execution.PodName, "-n", execution.Namespace)
		}

		if err := cmd.Run(); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": "Execution terminated"})
	}
}

func HandleBootstrapAWSSecret() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BootstrapAWSSecretRequest
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if req.SecretName == "" {
			req.SecretName = "terraform-aws-credentials"
		}
		if req.Namespace == "" {
			req.Namespace = "terraform"
		}

		if err := ensureTerraformNamespace(req.Namespace); err != nil {
			c.JSON(500, gin.H{"error": "Failed to create namespace", "details": err.Error()})
			return
		}

		secretYAML := fmt.Sprintf(`apiVersion: v1
kind: Secret
metadata:
  name: %s
  namespace: %s
type: Opaque
stringData:
  AWS_ACCESS_KEY_ID: "%s"
  AWS_SECRET_ACCESS_KEY: "%s"
  AWS_ROLE_ARN: "%s"
  TF_STATE_BUCKET: "%s"
  TF_STATE_REGION: "%s"
`, req.SecretName, req.Namespace, req.AWSAccessKeyID, req.AWSSecretKey, req.AWSRoleARN, req.StateBucket, req.StateRegion)

		cmd := exec.Command("kubectl", "apply", "-f", "-")
		cmd.Stdin = strings.NewReader(secretYAML)

		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			c.JSON(500, gin.H{
				"error":   "Failed to create secret",
				"details": stderr.String(),
			})
			return
		}

		c.JSON(200, gin.H{
			"message":     "AWS credentials secret created successfully",
			"secret_name": req.SecretName,
			"namespace":   req.Namespace,
		})
	}
}

func checkAWSSecretExists(namespace, secretName string) error {
	if secretName == "" {
		secretName = "terraform-aws-credentials"
	}
	if namespace == "" {
		namespace = "terraform"
	}

	cmd := exec.Command("kubectl", "get", "secret", secretName, "-n", namespace)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("AWS credentials secret '%s' not found in namespace '%s'. Please bootstrap the secret first using POST /api/terraform/bootstrap-secret", secretName, namespace)
	}
	return nil
}

func buildKubectlPodSpec(req *TerraformRequest, executionID string, podName, image, namespace, secretName string, labels map[string]string) ([]byte, error) {
	tfArgs := buildTerraformArgs(req)

	podSpec := map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Pod",
		"metadata": map[string]interface{}{
			"name":      podName,
			"namespace": namespace,
			"labels":    labels,
		},
		"spec": map[string]interface{}{
			"restartPolicy": "Never",
			"initContainers": []map[string]interface{}{
				{
					"name":    "validate-credentials",
					"image":   "amazon/aws-cli:latest",
					"command": []string{"/bin/sh", "-c"},
					"args":    []string{buildValidationScript(req.StateBucket, req.StateRegion)},
					"env":     buildSecretEnvVars(secretName),
				},
			},
			"containers": []map[string]interface{}{
				{
					"name":       "terraform",
					"image":      image,
					"command":    []string{"terraform"},
					"args":       tfArgs,
					"env":        append(buildSecretEnvVars(secretName), buildTerraformVarEnvs(req.Vars)...),
					"workingDir": "/workspace",
				},
			},
		},
	}

	if req.ServiceAccount != "" {
		podSpec["spec"].(map[string]interface{})["serviceAccountName"] = req.ServiceAccount
	}

	return json.MarshalIndent(podSpec, "", "  ")
}

func buildSecretEnvVars(secretName string) []map[string]interface{} {
	return []map[string]interface{}{
		{
			"name": "AWS_ACCESS_KEY_ID",
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name": secretName,
					"key":  "AWS_ACCESS_KEY_ID",
				},
			},
		},
		{
			"name": "AWS_SECRET_ACCESS_KEY",
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name": secretName,
					"key":  "AWS_SECRET_ACCESS_KEY",
				},
			},
		},
		{
			"name": "AWS_ROLE_ARN",
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name":     secretName,
					"key":      "AWS_ROLE_ARN",
					"optional": true,
				},
			},
		},
		{
			"name": "TF_STATE_BUCKET",
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name": secretName,
					"key":  "TF_STATE_BUCKET",
				},
			},
		},
		{
			"name": "TF_STATE_REGION",
			"valueFrom": map[string]interface{}{
				"secretKeyRef": map[string]interface{}{
					"name": secretName,
					"key":  "TF_STATE_REGION",
				},
			},
		},
	}
}

func buildTerraformVarEnvs(vars map[string]string) []map[string]interface{} {
	envs := []map[string]interface{}{}
	for key, value := range vars {
		envs = append(envs, map[string]interface{}{
			"name":  fmt.Sprintf("TF_VAR_%s", key),
			"value": value,
		})
	}
	return envs
}

func buildValidationScript(stateBucket, stateRegion string) string {
	if stateBucket == "" {
		return "echo 'No state bucket configured, skipping validation'"
	}

	return fmt.Sprintf(`#!/bin/sh
set -e

echo "=== Validating AWS Credentials ==="
aws sts get-caller-identity || {
  echo "ERROR: AWS credentials invalid"
  exit 1
}

echo "=== Validating S3 Bucket Access ==="
aws s3 ls s3://%s --region %s || {
  echo "ERROR: Cannot access bucket %s"
  exit 2
}

echo "=== Validation Complete ==="
`, stateBucket, stateRegion, stateBucket)
}
