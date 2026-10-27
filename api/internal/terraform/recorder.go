package terraform

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/uc-cdis/gen3-admin/internal/environments"
)

// outputsFileName is where a successful apply leaves `terraform output
// -json`, in the vars dir. It is read once, filtered to the non-sensitive
// outputs, and deleted, so secrets such as access keys never rest on disk
// outside the state.
const outputsFileName = "outputs.json"

// A successful plan leaves `terraform show -json` of the saved plan here,
// and the architecture diagram scripts/runner/plan-diagram.mjs drew from it.
const (
	planJSONFileName    = "plan.json"
	diagramJSONFileName = "diagram.json"
	diagramScript       = containerRepoDir + "/scripts/runner/plan-diagram.mjs"
)

// runRecorder writes a run into the environment registry: a "running" record
// when it starts, and the log, exit code, plan summary and outputs when it
// ends. Recording is best effort. A registry failure is logged and never
// fails or stops the run itself.
type runRecorder struct {
	store   *environments.Store
	env     string
	run     *environments.Run
	varsDir string
}

func runnerName(rt RuntimeType) string {
	host, _ := os.Hostname()
	if inCluster() {
		return "in-cluster:" + host
	}
	return string(rt) + ":" + host
}

func inCluster() bool {
	return os.Getenv("KUBERNETES_SERVICE_HOST") != ""
}

// startRecording opens the registry with the run's own identity, so it can
// read and write exactly what Terraform can.
func startRecording(ctx context.Context, req *TerraformRequest, executionID string) *runRecorder {
	if req.Environment == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()

	store, err := environments.OpenStore(ctx, req.StateBucket, runTarget(req))
	if err != nil {
		log.Warn().Err(err).Str("environment", req.Environment).Msg("run will not be recorded")
		return nil
	}
	r := &runRecorder{
		store: store,
		env:   req.Environment,
		run: &environments.Run{
			ID:        executionID,
			Operation: string(req.Operation),
			Status:    environments.RunRunning,
			Runner:    runnerName(req.Runtime),
			StartedAt: time.Now().UTC(),
		},
		varsDir: req.WorkDir + "-vars",
	}
	if err := store.PutRun(ctx, r.env, r.run); err != nil {
		log.Warn().Err(err).Str("environment", r.env).Msg("failed to record run start")
	}
	r.updateEnvironment(ctx, environments.StatusDuring(r.run.Operation), nil)
	return r
}

func (r *runRecorder) updateEnvironment(ctx context.Context, status environments.Status, outputs map[string]json.RawMessage, more ...func(*environments.Environment)) {
	_, err := r.store.Update(ctx, r.env, func(e *environments.Environment) {
		if status != "" {
			e.Status = status
		}
		e.LastRun = r.run
		if outputs != nil {
			e.Outputs = outputs
		}
		for _, fn := range more {
			fn(e)
		}
	})
	if errors.Is(err, environments.ErrNotFound) {
		// The wizard saves the environment before its first run; a run
		// against an unregistered name is still kept under runs/.
		return
	}
	if err != nil {
		log.Warn().Err(err).Str("environment", r.env).Msg("failed to update environment record")
	}
}

// finish records how the run ended. Called once the container has exited.
func (r *runRecorder) finish(exitCode int, logText []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	now := time.Now().UTC()
	r.run.EndedAt = &now
	r.run.ExitCode = &exitCode
	ok := exitCode == 0
	if ok {
		r.run.Status = environments.RunSucceeded
	} else {
		r.run.Status = environments.RunFailed
	}
	if r.run.Operation == string(OpPlan) && ok {
		r.run.Plan = environments.ParsePlanSummary(logText)
		if d := r.takePlan(); d != nil {
			r.run.Plan = &d.Summary
			if err := r.store.PutPlan(ctx, r.env, r.run.ID, d); err != nil {
				log.Warn().Err(err).Str("environment", r.env).Msg("failed to store plan detail")
			}
		}
		if g := r.takeDiagram(); g != nil {
			if err := r.store.PutDiagram(ctx, r.env, r.run.ID, g); err != nil {
				log.Warn().Err(err).Str("environment", r.env).Msg("failed to store plan diagram")
			}
		}
	}

	if err := r.store.PutLog(ctx, r.env, r.run.ID, logText); err != nil {
		log.Warn().Err(err).Str("environment", r.env).Msg("failed to store run log")
	}
	if err := r.store.PutRun(ctx, r.env, r.run); err != nil {
		log.Warn().Err(err).Str("environment", r.env).Msg("failed to record run end")
	}

	var outputs map[string]json.RawMessage
	if r.run.Operation == string(OpApply) {
		outputs = r.takeOutputs()
	}
	var more []func(*environments.Environment)
	if r.run.Operation == string(OpInstallCSOC) && ok {
		more = append(more, r.installResult())
	}
	// One write, so whoever sees the new status also sees the egress IP: the
	// wizard opens the configuration PR as soon as the status moves.
	r.updateEnvironment(ctx, environments.StatusAfter(r.run.Operation, ok), outputs, more...)
}

// installResult keeps the egress IP install-csoc found, which the CSOC's
// allowlist always includes from then on.
func (r *runRecorder) installResult() func(*environments.Environment) {
	res := takeInstallResult(r.varsDir)
	return func(e *environments.Environment) {
		if res == nil || res.EgressIP == "" {
			return
		}
		if e.Install == nil {
			e.Install = &environments.Install{}
		}
		e.Install.EgressIP = res.EgressIP
	}
}

// takePlan reads the plan JSON a successful plan left in the vars dir,
// deletes it, and keeps only the summary: the plan JSON has variable values
// in it.
func (r *runRecorder) takePlan() *environments.PlanDetail {
	planPath := filepath.Join(r.varsDir, planJSONFileName)
	defer os.Remove(planPath)
	raw, err := os.ReadFile(planPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Warn().Err(err).Msg("failed to read plan JSON")
		}
		return nil
	}
	d, err := environments.SummarizePlan(raw)
	if err != nil {
		log.Warn().Err(err).Msg("failed to summarize plan")
		return nil
	}
	return d
}

// takeDiagram reads and deletes the diagram a successful plan left, checked
// into its fixed shape.
func (r *runRecorder) takeDiagram() *environments.PlanDiagram {
	path := filepath.Join(r.varsDir, diagramJSONFileName)
	defer os.Remove(path)
	raw, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Warn().Err(err).Msg("failed to read plan diagram")
		}
		return nil
	}
	g, err := environments.ParseDiagram(raw)
	if err != nil {
		log.Warn().Err(err).Msg("ignoring the plan diagram")
		return nil
	}
	return g
}

// takeOutputs reads and deletes the outputs file a successful apply wrote.
func (r *runRecorder) takeOutputs() map[string]json.RawMessage {
	path := filepath.Join(r.varsDir, outputsFileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Warn().Err(err).Msg("failed to read terraform outputs")
		}
		return nil
	}
	if err := os.Remove(path); err != nil {
		log.Warn().Err(err).Msg("failed to remove terraform outputs file")
	}
	public, err := environments.PublicOutputs(raw)
	if err != nil {
		log.Warn().Err(err).Msg("terraform outputs were not valid JSON")
		return nil
	}
	return public
}

// awaitDockerRun blocks until the container exits, then removes the run's
// secret files and records the result. `docker wait` can return early, when
// the Docker socket proxy closes the connection after 10 minutes, so it is
// asked again until the container has really stopped.
func awaitDockerRun(name string, rec *runRecorder, secretFiles ...string) {
	for {
		err := exec.Command("docker", "wait", name).Run()
		running, ierr := executionRunning(&TerraformExecution{Runtime: RuntimeDocker, ContainerName: name})
		if ierr != nil || !running {
			break
		}
		if err != nil {
			time.Sleep(5 * time.Second)
		}
	}
	removeCredentials(secretFiles...)
	if rec == nil {
		return
	}
	code, err := executionExitCode(&TerraformExecution{Runtime: RuntimeDocker, ContainerName: name})
	if err != nil {
		code = -1
	}
	// CombinedOutput interleaves stdout and stderr as docker stored them,
	// which is how the live stream showed them.
	logText, err := exec.Command("docker", "logs", name).CombinedOutput()
	if err != nil {
		log.Warn().Err(err).Str("container", name).Msg("failed to read run log")
	}
	rec.finish(code, logText)
}
