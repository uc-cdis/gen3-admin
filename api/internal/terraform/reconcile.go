package terraform

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/uc-cdis/gen3-admin/internal/environments"
)

// Runs this process is waiting on, and runs someone asked to stop. Both are
// keyed by execution ID. After an API restart both are empty, which is what
// ReconcileRun is for.
var (
	awaiting sync.Map
	stopping sync.Map
)

// listDockerExecutions is replaced in tests.
var listDockerExecutions = queryDockerExecutions

func markStopped(id string) { stopping.Store(id, true) }

func wasStopped(id string) bool {
	_, ok := stopping.LoadAndDelete(id)
	return ok
}

// ReconcileRun settles an environment whose last run is recorded as running
// but that nothing in this process is waiting on, which happens when the API
// restarts mid-run. A container still going is adopted and recorded when it
// ends; one that already exited is recorded now; one that is gone is marked
// lost. Runs made by another runner, such as the in-cluster CSOC, are left
// alone.
func ReconcileRun(ctx context.Context, store *environments.Store, e *environments.Environment) {
	run := e.LastRun
	if run == nil || run.Status != environments.RunRunning || run.Runner != runnerName(RuntimeDocker) {
		return
	}
	if _, ok := awaiting.Load(run.ID); ok {
		return
	}
	execs, err := listDockerExecutions()
	if err != nil {
		return // docker unreachable: nothing can be said about the run
	}
	for _, x := range execs {
		if x.ID != run.ID {
			continue
		}
		workDir, err := resolveWorkDir(x.WorkDir)
		if err != nil {
			return
		}
		if _, loaded := awaiting.LoadOrStore(run.ID, true); loaded {
			return
		}
		rec := &runRecorder{store: store, env: e.Name, run: run, varsDir: workDir + "-vars"}
		go awaitDockerRun(x.ContainerName, rec)
		return
	}

	now := time.Now().UTC()
	run.Status, run.EndedAt = environments.RunLost, &now
	if err := store.PutRun(ctx, e.Name, run); err != nil {
		log.Warn().Err(err).Str("environment", e.Name).Msg("failed to record lost run")
	}
	updated, err := store.Update(ctx, e.Name, func(s *environments.Environment) {
		s.Status = environments.StatusAfter(run.Operation, run.Status, s.Status)
		s.LastRun = run
	})
	if err != nil {
		log.Warn().Err(err).Str("environment", e.Name).Msg("failed to record lost run")
		return
	}
	*e = *updated
}

// One run at a time per environment. Terraform's state lock covers only
// Terraform; two install scripts, or an uninstall beside an apply, would
// trip over each other. A run is recorded as running before its start
// request returns, so holding this lock across the check and the start is
// enough within this API, and the record covers other runners.
var claims sync.Map // environment name -> *sync.Mutex

type busyError struct{ run *environments.Run }

func (b *busyError) Error() string {
	ago := time.Since(b.run.StartedAt).Round(time.Minute)
	return fmt.Sprintf("%s is already running (started %s ago); wait for it to end, or stop it", b.run.Operation, ago)
}

// claimEnvironment refuses a run while another is going for the same
// environment, and returns the release for once this one is recorded.
func claimEnvironment(ctx context.Context, store *environments.Store, name string) (func(), error) {
	m, _ := claims.LoadOrStore(name, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	e, err := store.Get(ctx, name)
	if errors.Is(err, environments.ErrNotFound) {
		return mu.Unlock, nil
	}
	if err != nil {
		mu.Unlock()
		return nil, err
	}
	if e.LastRun != nil && e.LastRun.Status == environments.RunRunning {
		// A run whose end was never recorded is settled first, so a lost
		// one does not block the environment for good.
		ReconcileRun(ctx, store, e)
		if e.LastRun.Status == environments.RunRunning {
			mu.Unlock()
			return nil, &busyError{run: e.LastRun}
		}
	}
	return mu.Unlock, nil
}
