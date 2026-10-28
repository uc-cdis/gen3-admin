package environments

import (
	"encoding/json"
	"testing"
)

func TestStatusAfter(t *testing.T) {
	for _, tc := range []struct {
		op      string
		outcome RunStatus
		prev    Status
		want    Status
	}{
		{"init", RunSucceeded, StatusNew, StatusNew},
		{"plan", RunSucceeded, StatusNew, StatusPlanned},
		{"plan", RunSucceeded, StatusDestroyed, StatusPlanned},
		// A plan against running infrastructure does not forget it.
		{"plan", RunSucceeded, StatusInstalled, StatusInstalled},
		{"plan", RunFailed, StatusBootstrapped, StatusBootstrapped},
		{"validate", RunFailed, StatusInstalled, StatusInstalled},
		{"apply", RunSucceeded, StatusPlanned, StatusApplied},
		{"apply", RunSucceeded, StatusPartial, StatusApplied},
		{"apply", RunSucceeded, StatusInstalled, StatusInstalled},
		{"apply", RunFailed, StatusPlanned, StatusPartial},
		{"apply", RunStopped, StatusPlanned, StatusPartial},
		{"apply", RunLost, StatusNew, StatusPartial},
		{"apply", RunFailed, StatusInstalled, StatusInstalled},
		{"destroy", RunSucceeded, StatusPartial, StatusDestroyed},
		{"destroy", RunFailed, StatusApplied, StatusPartial},
		{"install-csoc", RunSucceeded, StatusApplied, StatusBootstrapped},
		{"install-csoc", RunFailed, StatusApplied, StatusApplied},
		{"finish-csoc", RunSucceeded, StatusBootstrapped, StatusInstalled},
		// A failed finish can be retried: the CSOC is still bootstrapped.
		{"finish-csoc", RunFailed, StatusBootstrapped, StatusBootstrapped},
		{"finish-csoc", RunStopped, StatusBootstrapped, StatusBootstrapped},
		{"uninstall-csoc", RunSucceeded, StatusInstalled, StatusApplied},
		{"uninstall-csoc", RunFailed, StatusInstalled, StatusInstalled},
		// Cleaning up again before a retried destroy.
		{"uninstall-csoc", RunSucceeded, StatusPartial, StatusPartial},
	} {
		if got := StatusAfter(tc.op, tc.outcome, tc.prev); got != tc.want {
			t.Errorf("StatusAfter(%s, %s, %s) = %s, want %s", tc.op, tc.outcome, tc.prev, got, tc.want)
		}
	}
}

func TestSettleMapsLegacyStatuses(t *testing.T) {
	outputs := map[string]json.RawMessage{"cluster_name": []byte(`"dev"`)}
	for _, tc := range []struct {
		name string
		e    Environment
		want Status
	}{
		{"initialized", Environment{Status: legacyInitialized}, StatusNew},
		{"failed finish", Environment{Status: legacyFailed, Outputs: outputs,
			LastRun: &Run{Operation: "finish-csoc", Status: RunFailed}}, StatusBootstrapped},
		{"failed install", Environment{Status: legacyFailed, Outputs: outputs,
			LastRun: &Run{Operation: "install-csoc", Status: RunFailed}}, StatusApplied},
		{"failed first apply", Environment{Status: legacyFailed,
			LastRun: &Run{Operation: "apply", Status: RunFailed}}, StatusPartial},
		{"failed destroy", Environment{Status: legacyFailed, Outputs: outputs,
			LastRun: &Run{Operation: "destroy", Status: RunFailed}}, StatusPartial},
		{"failed plan after apply", Environment{Status: legacyFailed, Outputs: outputs,
			LastRun: &Run{Operation: "plan", Status: RunFailed}}, StatusApplied},
		{"failed uninstall", Environment{Status: legacyFailed, Outputs: outputs, Install: &Install{Mode: InstallDirect},
			LastRun: &Run{Operation: "uninstall-csoc", Status: RunFailed}}, StatusInstalled},
		{"apply in progress", Environment{Status: legacyApplying,
			LastRun: &Run{Operation: "apply", Status: RunRunning}}, StatusNew},
		{"plan after apply", Environment{Status: StatusPlanned, Outputs: outputs,
			LastRun: &Run{Operation: "plan", Status: RunSucceeded}}, StatusApplied},
		{"plan after a bootstrap", Environment{Status: StatusPlanned, Outputs: outputs, Install: &Install{EgressIP: "192.0.2.1"},
			LastRun: &Run{Operation: "plan", Status: RunSucceeded}}, StatusBootstrapped},
		{"first plan", Environment{Status: StatusPlanned}, StatusPlanned},
		{"current rules untouched", Environment{Status: StatusPlanned, StatusVersion: statusVersion, Outputs: outputs}, StatusPlanned},
	} {
		e := tc.e
		Settle(&e)
		if e.Status != tc.want {
			t.Errorf("%s: settled to %s, want %s", tc.name, e.Status, tc.want)
		}
	}
}
