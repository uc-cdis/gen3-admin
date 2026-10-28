package environments

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/uc-cdis/gen3-admin/internal/environments/envtest"
)

const testPlanJSON = `{
  "terraform_version": "1.16.5",
  "variables": {"db_password": {"value": "hunter2-not-for-the-registry"}},
  "resource_changes": [
    {"address": "module.vpc.aws_vpc.main", "module_address": "module.vpc", "mode": "managed", "type": "aws_vpc",
     "change": {"actions": ["create"], "after": {"cidr_block": "172.24.16.0/20"}}},
    {"address": "module.vpc.aws_nat_gateway.gw", "module_address": "module.vpc", "mode": "managed", "type": "aws_nat_gateway",
     "change": {"actions": ["create"]}},
    {"address": "module.eks.aws_eks_cluster.this", "module_address": "module.eks", "mode": "managed", "type": "aws_eks_cluster",
     "change": {"actions": ["create"]}},
    {"address": "aws_iam_role.lb", "mode": "managed", "type": "aws_iam_role", "change": {"actions": ["update"]}},
    {"address": "aws_acm_certificate.csoc[0]", "mode": "managed", "type": "aws_acm_certificate",
     "action_reason": "replace_because_cannot_update", "change": {"actions": ["delete", "create"]}},
    {"address": "aws_s3_bucket.old", "mode": "managed", "type": "aws_s3_bucket", "change": {"actions": ["delete"]}},
    {"address": "aws_security_group.same", "mode": "managed", "type": "aws_security_group", "change": {"actions": ["no-op"]}},
    {"address": "module.eks.time_sleep.wait", "mode": "managed", "type": "time_sleep", "change": {"actions": ["create"]}},
    {"address": "data.aws_caller_identity.current", "mode": "data", "type": "aws_caller_identity", "change": {"actions": ["read"]}}
  ]
}`

func TestSummarizePlan(t *testing.T) {
	d, err := SummarizePlan([]byte(testPlanJSON))
	if err != nil {
		t.Fatal(err)
	}
	if d.Summary != (PlanSummary{Add: 5, Change: 1, Destroy: 2}) {
		t.Errorf("summary = %+v, want the counts Terraform prints (a replace is one add and one destroy)", d.Summary)
	}
	var names []string
	for _, g := range d.Groups {
		names = append(names, g.Name)
	}
	if got := strings.Join(names, ","); got != "Network,Kubernetes cluster,IAM roles and policies,DNS and certificate,Storage and databases,Terraform helpers" {
		t.Errorf("groups = %s", got)
	}
	for _, g := range d.Groups {
		for _, c := range g.Changes {
			if c.Address == "aws_acm_certificate.csoc[0]" && (c.Action != "replace" || c.Reason == "") {
				t.Errorf("replacement = %+v", c)
			}
			if strings.HasPrefix(c.Address, "data.") || c.Address == "aws_security_group.same" {
				t.Errorf("%s is not a change", c.Address)
			}
		}
	}
	b, _ := json.Marshal(d)
	if strings.Contains(string(b), "hunter2") || strings.Contains(string(b), "172.24.16.0/20") {
		t.Error("the summary kept values from the plan")
	}
}

func TestParsePlanSummaryIgnoresColour(t *testing.T) {
	log := []byte("\x1b[0m\x1b[1mPlan:\x1b[0m \x1b[1m133 to add, 0 to change, 0 to destroy.\x1b[0m\n")
	p := ParsePlanSummary(log)
	if p == nil || p.Add != 133 {
		t.Errorf("summary = %+v", p)
	}
}

func TestPlanStoredApartFromRuns(t *testing.T) {
	ctx := context.Background()
	store := NewStore(envtest.NewMemS3(), "bucket")
	id := "11111111-2222-3333-4444-555555555555"
	if err := store.PutRun(ctx, "dev", &Run{ID: id, Operation: "plan", Status: RunSucceeded}); err != nil {
		t.Fatal(err)
	}
	d, _ := SummarizePlan([]byte(testPlanJSON))
	if err := store.PutPlan(ctx, "dev", id, d); err != nil {
		t.Fatal(err)
	}
	runs, err := store.Runs(ctx, "dev")
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs = %d (%v); the plan detail must not be listed as a run", len(runs), err)
	}
	got, err := store.GetPlan(ctx, "dev", id)
	if err != nil || got.Summary != d.Summary || len(got.Groups) != len(d.Groups) {
		t.Errorf("GetPlan = %+v, %v", got, err)
	}
	if _, err := store.GetPlan(ctx, "dev", "../../x"); err == nil {
		t.Error("a bad run id was read")
	}
}

func TestClusterResourcesHaveTheirOwnGroup(t *testing.T) {
	for _, typ := range []string{"helm_release", "kubectl_manifest", "kubernetes_namespace"} {
		if g := groupOf(typ); g != "In the cluster" {
			t.Errorf("groupOf(%s) = %q", typ, g)
		}
	}
}
