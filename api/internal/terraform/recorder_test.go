package terraform

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/uc-cdis/gen3-admin/internal/environments"
	"github.com/uc-cdis/gen3-admin/internal/environments/envtest"
)

func newTestRecorder(t *testing.T, op TerraformOperation) (*runRecorder, *environments.Store) {
	t.Helper()
	store := environments.NewStore(envtest.NewMemS3(), "b")
	if _, err := store.Save(context.Background(), &environments.Environment{Name: "dev", Kind: environments.KindCSOC}); err != nil {
		t.Fatal(err)
	}
	return &runRecorder{
		store:   store,
		env:     "dev",
		run:     &environments.Run{ID: "00000000-0000-0000-0000-000000000001", Operation: string(op), Status: environments.RunRunning, StartedAt: time.Now()},
		varsDir: t.TempDir(),
	}, store
}

func TestRecorderStoresPlanSummaryAndLog(t *testing.T) {
	rec, store := newTestRecorder(t, OpPlan)
	rec.finish(0, []byte("Plan: 5 to add, 1 to change, 0 to destroy."))

	e, _ := store.Get(context.Background(), "dev")
	if e.Status != environments.StatusPlanned || e.LastRun.Plan == nil || e.LastRun.Plan.Add != 5 {
		t.Errorf("environment after plan = %+v (last run %+v)", e, e.LastRun)
	}
	if b, _ := store.GetLog(context.Background(), "dev", rec.run.ID); !strings.Contains(string(b), "5 to add") {
		t.Errorf("log = %q", b)
	}
}

func TestRecorderKeepsOnlyPublicOutputsAndDeletesTheFile(t *testing.T) {
	rec, store := newTestRecorder(t, OpApply)
	path := filepath.Join(rec.varsDir, outputsFileName)
	if err := os.WriteFile(path, []byte(`{"cluster_name":{"sensitive":false,"value":"dev"},"key":{"sensitive":true,"value":"SECRET"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	rec.finish(0, []byte("Apply complete!"))

	e, _ := store.Get(context.Background(), "dev")
	if e.Status != environments.StatusApplied || string(e.Outputs["cluster_name"]) != `"dev"` {
		t.Errorf("environment after apply = %+v", e)
	}
	if _, ok := e.Outputs["key"]; ok {
		t.Error("sensitive output stored in the registry")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("outputs file left on disk")
	}
}

func TestRecorderMarksFailure(t *testing.T) {
	rec, store := newTestRecorder(t, OpApply)
	rec.finish(1, []byte("Error: boom"))
	e, _ := store.Get(context.Background(), "dev")
	// A first apply that fails may have created some of the infrastructure.
	if e.Status != environments.StatusPartial || e.LastRun.Status != environments.RunFailed || *e.LastRun.ExitCode != 1 {
		t.Errorf("environment after failed apply = %+v", e)
	}
}

func TestRecorderKeepsStatusWhenAStoppedRunEnds(t *testing.T) {
	rec, store := newTestRecorder(t, OpFinishCSOC)
	if _, err := store.Update(context.Background(), "dev", func(e *environments.Environment) {
		e.Status = environments.StatusBootstrapped
	}); err != nil {
		t.Fatal(err)
	}
	markStopped(rec.run.ID)
	rec.finish(143, nil)
	e, _ := store.Get(context.Background(), "dev")
	if e.Status != environments.StatusBootstrapped || e.LastRun.Status != environments.RunStopped {
		t.Errorf("environment after a stopped finish = %s, last run %s", e.Status, e.LastRun.Status)
	}
}

func TestEnvironmentRunRequiresBucketAndValidName(t *testing.T) {
	for _, req := range []*TerraformRequest{
		{Operation: OpPlan, Environment: "dev"},
		{Operation: OpPlan, Environment: "../dev", StateBucket: "bucket-a"},
	} {
		if err := validateRequest(req); err == nil {
			t.Errorf("validateRequest(%+v) succeeded", req)
		}
	}
}

func TestApplyForEnvironmentSavesOutputs(t *testing.T) {
	req := &TerraformRequest{Operation: OpApply, Environment: "dev", WorkDir: "/w/dev"}
	if !strings.Contains(strings.Join(buildDockerRunArgs(req, "00000000-0000-0000-0000-000000000001", ""), " "), "GEN3_SAVE_OUTPUTS=1") {
		t.Error("apply for an environment does not ask the prelude to save outputs")
	}
	req.Operation = OpPlan
	if strings.Contains(strings.Join(buildDockerRunArgs(req, "00000000-0000-0000-0000-000000000001", ""), " "), "GEN3_SAVE_OUTPUTS=1") {
		t.Error("plan asks the prelude to save outputs")
	}
}

func TestPlanForEnvironmentSavesPlanJSON(t *testing.T) {
	req := &TerraformRequest{Operation: OpPlan, Environment: "dev", WorkDir: "/w/dev"}
	joined := strings.Join(buildDockerRunArgs(req, "00000000-0000-0000-0000-000000000001", ""), " ")
	for _, want := range []string{"GEN3_SAVE_PLAN=1", "TF_CLI_ARGS=-no-color"} {
		if !strings.Contains(joined, want) {
			t.Errorf("plan args are missing %s", want)
		}
	}
	// The prelude script itself is in the argv, so look for the -e flag only.
	req.Operation = OpApply
	if strings.Contains(strings.Join(buildDockerRunArgs(req, "00000000-0000-0000-0000-000000000001", ""), " "), "GEN3_SAVE_PLAN=1") {
		t.Error("apply asks the prelude to save a plan")
	}
}

func TestRecorderKeepsEgressIPWithBootstrappedStatus(t *testing.T) {
	rec, store := newTestRecorder(t, OpInstallCSOC)
	_, _ = store.Update(context.Background(), "dev", func(e *environments.Environment) {
		e.Install = &environments.Install{AllowedCIDRs: []string{"203.0.113.7/32"}}
	})
	if err := os.WriteFile(filepath.Join(rec.varsDir, installResultFile), []byte(`{"egress_ip":"192.0.2.44"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	rec.finish(0, []byte("=== ArgoCD is ready ==="))

	e, _ := store.Get(context.Background(), "dev")
	if e.Status != environments.StatusBootstrapped {
		t.Errorf("status = %s, want bootstrapped", e.Status)
	}
	if e.Install == nil || e.Install.EgressIP != "192.0.2.44" || len(e.Install.AllowedCIDRs) != 1 {
		t.Errorf("install = %+v", e.Install)
	}
}
