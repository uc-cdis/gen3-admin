package terraform

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/uc-cdis/gen3-admin/internal/environments"
)

func TestReconcileMarksAVanishedRunLost(t *testing.T) {
	listDockerExecutions = func() ([]*TerraformExecution, error) { return nil, nil }
	t.Cleanup(func() { listDockerExecutions = queryDockerExecutions })

	ctx := context.Background()
	_, store := newTestRecorder(t, OpApply)
	run := &environments.Run{ID: "00000000-0000-0000-0000-000000000009", Operation: "apply",
		Status: environments.RunRunning, Runner: runnerName(RuntimeDocker), StartedAt: time.Now()}
	if _, err := store.Update(ctx, "dev", func(e *environments.Environment) {
		e.Status, e.LastRun = environments.StatusPlanned, run
	}); err != nil {
		t.Fatal(err)
	}
	e, _ := store.Get(ctx, "dev")
	ReconcileRun(ctx, store, e)
	if e.LastRun.Status != environments.RunLost || e.Status != environments.StatusPartial {
		t.Errorf("after reconcile: status %s, last run %s", e.Status, e.LastRun.Status)
	}
	stored, _ := store.Get(ctx, "dev")
	if stored.LastRun.Status != environments.RunLost {
		t.Errorf("lost run not stored: %s", stored.LastRun.Status)
	}
}

func TestReconcileLeavesOtherRunnersAlone(t *testing.T) {
	listDockerExecutions = func() ([]*TerraformExecution, error) {
		t.Fatal("docker was queried for a run made elsewhere")
		return nil, nil
	}
	t.Cleanup(func() { listDockerExecutions = queryDockerExecutions })

	_, store := newTestRecorder(t, OpApply)
	e := &environments.Environment{Name: "dev", Status: environments.StatusPlanned,
		LastRun: &environments.Run{ID: "x", Operation: "apply", Status: environments.RunRunning, Runner: "in-cluster:csoc-0"}}
	ReconcileRun(context.Background(), store, e)
	if e.LastRun.Status != environments.RunRunning {
		t.Errorf("run made elsewhere was changed to %s", e.LastRun.Status)
	}
}

func TestOneRunPerEnvironment(t *testing.T) {
	listDockerExecutions = func() ([]*TerraformExecution, error) {
		return []*TerraformExecution{{ID: "00000000-0000-0000-0000-00000000000a", ContainerName: "c", WorkDir: "csoc-dev"}}, nil
	}
	t.Cleanup(func() { listDockerExecutions = queryDockerExecutions })
	awaiting.Store("00000000-0000-0000-0000-00000000000a", true) // this process follows it
	t.Cleanup(func() { awaiting.Delete("00000000-0000-0000-0000-00000000000a") })

	ctx := context.Background()
	_, store := newTestRecorder(t, OpApply)
	release, err := claimEnvironment(ctx, store, "dev")
	if err != nil {
		t.Fatal(err)
	}
	release()
	if _, err := store.Update(ctx, "dev", func(e *environments.Environment) {
		e.LastRun = &environments.Run{ID: "00000000-0000-0000-0000-00000000000a", Operation: "apply",
			Status: environments.RunRunning, Runner: runnerName(RuntimeDocker), StartedAt: time.Now()}
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := claimEnvironment(ctx, store, "dev"); err == nil || !strings.Contains(err.Error(), "apply is already running") {
		t.Errorf("a second run was allowed: %v", err)
	}
}
