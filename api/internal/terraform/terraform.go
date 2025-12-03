package terraform

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
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

func buildDockerCommand(req *TerraformRequest, executionID string) (string, []string) {
	op := strings.Split(string(req.Operation), " ")[0]
	containerName := fmt.Sprintf("tf-%s-%s", strings.ToLower(string(op)), executionID[:8])
	homeDir, _ := os.UserHomeDir()

	// Get AWS_PROFILE from environment
	awsProfile := os.Getenv("AWS_PROFILE")
	awsProfileFlag := ""
	if awsProfile != "" {
		awsProfileFlag = fmt.Sprintf("-e AWS_PROFILE=%s", awsProfile)
	}

	// Validation command
	validationCmd := ""
	if req.StateBucket != "" {
		validationCmd = fmt.Sprintf(`
echo "=== Running credential validation ==="
docker run --rm \
  -v %s/.aws:/root/.aws:ro \
  %s \
  -e TF_STATE_BUCKET=%s \
  -e TF_STATE_REGION=%s \
  amazon/aws-cli:latest \
  sh -c '%s' || exit $?

echo "=== Validation passed ==="
`, homeDir, awsProfileFlag, req.StateBucket, req.StateRegion, buildValidationScript(req.StateBucket, req.StateRegion))
	}

	tfArgs := buildTerraformArgs(req)
	tfCommand := strings.Join(tfArgs, " ")
	println("[DEBUG]: TFcommand: ", tfCommand)

	// Build environment flags for main Terraform container
	envFlags := ""
	if req.StateBucket != "" {
		envFlags += fmt.Sprintf("-e TF_STATE_BUCKET=%s -e TF_STATE_REGION=%s ", req.StateBucket, req.StateRegion)
	}
	for key, value := range req.Vars {
		envFlags += fmt.Sprintf("-e TF_VAR_%s=%s ", key, value)
	}

	// Pass AWS_PROFILE if set
	if awsProfile != "" {
		envFlags += fmt.Sprintf("-e AWS_PROFILE=%s ", awsProfile)
	}

	networkFlag := ""
	if req.DockerNetwork != "" {
		networkFlag = fmt.Sprintf("--network %s", req.DockerNetwork)
	}

	image := req.DockerImage
	if image == "" {
		image = "hashicorp/terraform:latest"
	}

	script := fmt.Sprintf(`%s
docker run \
  --name %s \
  --label %s=%s \
  --label %s=%s \
  --label %s=%s \
  --label %s=%s \
  -v %s/.aws:/root/.aws:ro \
  -v %s:/workspace/csoc:rw \
  -v %s-vars/terraform.tfvars:/workspace/gen3-terraform/terraform.tfvars:rw \
  -w /workspace/csoc \
  %s \
  %s \
  %s \
  -- "%s"
  `,
		validationCmd,
		containerName,
		LabelManagedBy, ManagedByValue,
		LabelComponent, ComponentValue,
		LabelOperation, string(op),
		LabelExecutionID, executionID,
		homeDir,
		req.WorkDir,
		req.WorkDir,
		envFlags,
		networkFlag,
		image,
		tfCommand,
	)

	print(script)
	return "sh", []string{"-c", script}
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
	var args []string

	// // If it's not the official Terraform image, prepend "terraform"
	if req.DockerImage != "hashicorp/terraform:latest" {
		args = append(args, "terraform")
	}

	// Add init, &&, terraform <operation>
	// args = append(args, "init", "&&", "terraform", string(req.Operation))
	args = append(args, string(req.Operation))

	switch req.Operation {
	case OpInit:
		// Add any init-specific flags
	case OpPlan:
		for _, varFile := range req.VarFiles {
			args = append(args, "-var-file=/workspace/gen3-terraform/"+varFile)
		}
		args = append(args, "-out=/workspace/gen3-terraform/tfplan")
	case OpApply:
		if req.AutoApprove {
			args = append(args, "-auto-approve")
		}
		for _, varFile := range req.VarFiles {
			args = append(args, "-var-file=/workspace/gen3-terraform/"+varFile)
		}
	case OpDestroy:
		if req.AutoApprove {
			args = append(args, "-auto-approve")
		}
		for _, varFile := range req.VarFiles {
			args = append(args, "-var-file=/workspace/gen3-terraform/"+varFile)
		}
	case OpOutput:
		args = append(args, "-json")
	case OpValidate:
		// No additional args needed
	}

	fmt.Printf("[DEBUG] args: %#v\n", args)

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

func HandleTerraformExecute() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req TerraformRequest
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if strings.TrimSpace(req.WorkDir) == "" {
			req.WorkDir = "/tmp/gen3-terraform"
		}
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
			name := req.DockerTFVarsFileName
			if name == "" {
				name = "terraform.tfvars"
			}
			tfvarsPath := filepath.Join(req.WorkDir+"-vars", name)
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

		var cmd *exec.Cmd
		switch req.Runtime {
		case RuntimeDocker:
			command, args := buildDockerCommand(&req, executionID)
			cmd = exec.Command(command, args...)

		case RuntimePod:
			if err := checkAWSSecretExists(req.Namespace, req.SecretName); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}

			var err error
			cmd, _, err = buildKubectlCommand(&req, executionID)
			if err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}

		default:
			c.JSON(400, gin.H{"error": "Invalid runtime type"})
			return
		}

		type ExecResult struct {
			Err    error
			Stdout string
			Stderr string
		}

		errCh := make(chan ExecResult, 1)

		// Prepare output buffers
		var stdoutBuf, stderrBuf bytes.Buffer
		cmd.Stdout = &stdoutBuf
		cmd.Stderr = &stderrBuf

		go func() {
			err := cmd.Run()
			errCh <- ExecResult{
				Err:    err,
				Stdout: stdoutBuf.String(),
				Stderr: stderrBuf.String(),
			}
		}()

		// Wait for execution to be visible or early failure
		for i := 0; i < 10; i++ {
			select {
			case res := <-errCh:
				if res.Err != nil {
					log.Error().
						Err(res.Err).
						Str("execution_id", executionID).
						Str("stderr", res.Stderr).
						Msg("Execution failed early")

					c.JSON(500, gin.H{
						"id":      executionID,
						"message": "Terraform execution failed to start",
						"error":   res.Err.Error(),
						"stderr":  res.Stderr,
					})
					return
				}
			default:
				// keep waiting
			}

			time.Sleep(500 * time.Millisecond)

			var execs []*TerraformExecution
			if req.Runtime == RuntimeDocker {
				execs, _ = queryDockerExecutions()
			} else {
				execs, _ = queryKubernetesPods(req.Namespace)
			}

			for _, exec := range execs {
				if exec.ID == executionID {
					c.JSON(202, gin.H{
						"id":      executionID,
						"message": fmt.Sprintf("Terraform %s execution started", req.Operation),
						"runtime": req.Runtime,
					})
					return
				}
			}
		}

		// timeout or late failure
		res := <-errCh
		if res.Err != nil {
			log.Error().
				Err(res.Err).
				Str("stderr", res.Stderr).
				Str("execution_id", executionID).
				Msg("Execution failed")

			c.JSON(500, gin.H{
				"error":   res.Err.Error(),
				"stderr":  res.Stderr,
				"stdout":  res.Stdout,
				"runtime": req.Runtime,
			})
		} else {
			c.JSON(504, gin.H{"error": "Execution not visible after timeout"})
		}

	}
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
				c.SSEvent("error", fmt.Sprintf("Pod failed to become ready: %v", err))
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
			c.SSEvent("error", err.Error())
			c.Writer.Flush()
			return
		}

		stderr, err := cmd.StderrPipe()
		if err != nil {
			c.SSEvent("error", err.Error())
			c.Writer.Flush()
			return
		}

		if err := cmd.Start(); err != nil {
			c.SSEvent("error", err.Error())
			c.Writer.Flush()
			return
		}

		done := make(chan bool, 2)

		go func() {
			defer func() { done <- true }()

			buf := make([]byte, 1024)

			for {
				select {
				case <-ctx.Done():
					return
				default:
					n, err := stdout.Read(buf)
					if n > 0 {
						c.SSEvent("message", string(buf[:n]))
						c.Writer.Flush()
					}
					if err != nil {
						return
					}
				}
			}
		}()

		go func() {
			defer func() { done <- true }()
			scanner := bufio.NewScanner(stderr)
			for scanner.Scan() {
				select {
				case <-ctx.Done():
					return
				default:
					c.SSEvent("error", scanner.Text())
					c.Writer.Flush()
				}
			}
		}()

		<-done
		<-done

		cmd.Wait()

		select {
		case <-ctx.Done():
		default:
			c.SSEvent("done", "completed")
			c.Writer.Flush()
		}
	}
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
