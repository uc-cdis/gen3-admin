package environments

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/uc-cdis/gen3-admin/internal/environments/envtest"
)

func TestSaveCreatesThenPreservesRunOwnedFields(t *testing.T) {
	ctx := context.Background()
	store := NewStore(envtest.NewMemS3(), "b")

	e, err := store.Save(ctx, &Environment{Name: "dev", Kind: KindCSOC, Region: "us-east-1"})
	if err != nil {
		t.Fatal(err)
	}
	if e.Status != StatusNew || e.StateKey != "gen3-csoc/environments/dev/terraform.tfstate" {
		t.Errorf("new environment = %+v", e)
	}

	if _, err := store.Update(ctx, "dev", func(e *Environment) {
		e.Status = StatusApplied
		e.Outputs = map[string]json.RawMessage{"cluster_name": []byte(`"dev"`)}
	}); err != nil {
		t.Fatal(err)
	}

	// The wizard saving its form again must not reset what runs recorded.
	e, err = store.Save(ctx, &Environment{Name: "dev", Kind: KindCSOC, Region: "us-east-1", Tfvars: "x = 1"})
	if err != nil {
		t.Fatal(err)
	}
	if e.Status != StatusApplied || string(e.Outputs["cluster_name"]) != `"dev"` || e.Tfvars != "x = 1" {
		t.Errorf("resaved environment lost run state: %+v", e)
	}
}

func TestSaveRejectsBadNameAndKind(t *testing.T) {
	store := NewStore(envtest.NewMemS3(), "b")
	for _, e := range []*Environment{
		{Name: "../x", Kind: KindCSOC},
		{Name: "UPPER", Kind: KindCSOC},
		{Name: "ok", Kind: "other"},
	} {
		if _, err := store.Save(context.Background(), e); err == nil {
			t.Errorf("Save(%+v) succeeded", e)
		}
	}
}

func TestListSkipsStateWithoutRecord(t *testing.T) {
	ctx := context.Background()
	mem := envtest.NewMemS3()
	store := NewStore(mem, "b")
	mem.Objects[StateKey("orphan")] = []byte("{}")
	for _, n := range []string{"b-env", "a-env"} {
		if _, err := store.Save(ctx, &Environment{Name: n, Kind: KindCommons}); err != nil {
			t.Fatal(err)
		}
	}
	envs, err := store.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(envs) != 2 || envs[0].Name != "a-env" || envs[1].Name != "b-env" {
		t.Errorf("List = %v, want a-env, b-env", envs)
	}
}

func TestRunsNewestFirstAndLogs(t *testing.T) {
	ctx := context.Background()
	store := NewStore(envtest.NewMemS3(), "b")
	t0 := time.Now()
	ids := []string{"00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"}
	for i, id := range ids {
		if err := store.PutRun(ctx, "dev", &Run{ID: id, Operation: "plan", StartedAt: t0.Add(time.Duration(i) * time.Minute)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.PutLog(ctx, "dev", ids[0], []byte("hello")); err != nil {
		t.Fatal(err)
	}
	runs, err := store.Runs(ctx, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || runs[0].ID != ids[1] {
		t.Errorf("Runs = %v, want newest first and logs excluded", runs)
	}
	if b, err := store.GetLog(ctx, "dev", ids[0]); err != nil || string(b) != "hello" {
		t.Errorf("GetLog = %q, %v", b, err)
	}
	if _, err := store.GetLog(ctx, "dev", "../../x"); err == nil {
		t.Error("GetLog accepted a traversal run id")
	}
	if _, err := store.GetLog(ctx, "dev", "00000000-0000-0000-0000-000000000009"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing log err = %v, want ErrNotFound", err)
	}
}

func TestParsePlanSummary(t *testing.T) {
	if p := ParsePlanSummary([]byte("...\nPlan: 112 to add, 0 to change, 3 to destroy.\n")); p == nil || *p != (PlanSummary{112, 0, 3}) {
		t.Errorf("summary = %+v", p)
	}
	if p := ParsePlanSummary([]byte("No changes. Your infrastructure matches the configuration.")); p == nil || *p != (PlanSummary{}) {
		t.Errorf("no-change summary = %+v", p)
	}
	if p := ParsePlanSummary([]byte("Error: something")); p != nil {
		t.Errorf("error log summary = %+v, want nil", p)
	}
}

func TestPublicOutputsDropsSensitive(t *testing.T) {
	raw := []byte(`{"cluster_name":{"sensitive":false,"type":"string","value":"dev"},
		"gitops_user_secret_access_key":{"sensitive":true,"type":"string","value":"SECRET"}}`)
	out, err := PublicOutputs(raw)
	if err != nil {
		t.Fatal(err)
	}
	if string(out["cluster_name"]) != `"dev"` {
		t.Errorf("cluster_name = %s", out["cluster_name"])
	}
	if _, ok := out["gitops_user_secret_access_key"]; ok {
		t.Error("a sensitive output was kept")
	}
}
