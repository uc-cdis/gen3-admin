package environments

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// PlanDetail is what a plan would do, resource by resource, for reviewing it
// before apply. It is built from `terraform show -json` of the saved plan,
// keeping only addresses, types and actions: the plan JSON itself carries
// variable values and attributes, some secret, and is never stored.
type PlanDetail struct {
	Summary PlanSummary  `json:"summary"`
	Groups  []PlanGroup  `json:"groups"`
	Format  string       `json:"terraform_version,omitempty"`
	Changes []PlanChange `json:"-"`
}

// PlanGroup is the changes to one part of the system, such as the network
// or the cluster.
type PlanGroup struct {
	Name    string       `json:"name"`
	Changes []PlanChange `json:"changes"`
}

type PlanChange struct {
	Address string `json:"address"`
	Type    string `json:"type"`
	Module  string `json:"module,omitempty"`
	// Action is create, update, delete or replace.
	Action string `json:"action"`
	// Reason is Terraform's, for a replacement: why it cannot update in place.
	Reason string `json:"reason,omitempty"`
}

var ansi = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// StripANSI removes terminal colour codes from a log.
func StripANSI(b []byte) []byte { return ansi.ReplaceAll(b, nil) }

// groupOf names the part of the system a resource type belongs to.
func groupOf(typ string) string {
	switch {
	case strings.HasPrefix(typ, "random_"), strings.HasPrefix(typ, "time_"), strings.HasPrefix(typ, "null_"),
		typ == "terraform_data":
		return "Terraform helpers"
	case strings.HasPrefix(typ, "aws_eks_"):
		return "Kubernetes cluster"
	case strings.HasPrefix(typ, "helm_"), strings.HasPrefix(typ, "kubectl_"), strings.HasPrefix(typ, "kubernetes_"):
		return "In the cluster"
	case strings.HasPrefix(typ, "aws_iam_"):
		return "IAM roles and policies"
	case strings.HasPrefix(typ, "aws_acm_"), strings.HasPrefix(typ, "aws_route53_"):
		return "DNS and certificate"
	case strings.HasPrefix(typ, "aws_security_group"), strings.HasPrefix(typ, "aws_vpc_security_group"),
		strings.HasPrefix(typ, "aws_network_acl"):
		return "Firewall rules"
	case strings.HasPrefix(typ, "aws_vpc"), strings.HasPrefix(typ, "aws_subnet"), strings.HasPrefix(typ, "aws_route"),
		strings.HasPrefix(typ, "aws_nat_gateway"), strings.HasPrefix(typ, "aws_internet_gateway"),
		strings.HasPrefix(typ, "aws_eip"), strings.HasPrefix(typ, "aws_flow_log"), strings.HasPrefix(typ, "aws_default_"),
		strings.HasPrefix(typ, "aws_main_route_table"):
		return "Network"
	case strings.HasPrefix(typ, "aws_instance"), strings.HasPrefix(typ, "aws_launch_template"),
		strings.HasPrefix(typ, "aws_autoscaling"), strings.HasPrefix(typ, "aws_key_pair"), strings.HasPrefix(typ, "aws_lb"):
		return "Compute and load balancing"
	case strings.HasPrefix(typ, "aws_s3_"), strings.HasPrefix(typ, "aws_ebs_"), strings.HasPrefix(typ, "aws_elasticsearch"),
		strings.HasPrefix(typ, "aws_opensearch"), strings.HasPrefix(typ, "aws_db_"), strings.HasPrefix(typ, "aws_rds_"):
		return "Storage and databases"
	case strings.HasPrefix(typ, "aws_cloudwatch_"), strings.HasPrefix(typ, "aws_cloudtrail"), strings.HasPrefix(typ, "aws_kms_"), strings.HasPrefix(typ, "aws_sns_"),
		strings.HasPrefix(typ, "aws_sqs_"), strings.HasPrefix(typ, "aws_lambda_"), strings.HasPrefix(typ, "aws_secretsmanager_"):
		return "Logging, keys and events"
	}
	return "Other"
}

var groupOrder = []string{
	"Network", "Firewall rules", "Kubernetes cluster", "In the cluster", "Compute and load balancing", "IAM roles and policies",
	"DNS and certificate", "Storage and databases", "Logging, keys and events", "Other",
	// Last: they create nothing in the cloud.
	"Terraform helpers",
}

func actionOf(actions []string) string {
	switch strings.Join(actions, ",") {
	case "create":
		return "create"
	case "update":
		return "update"
	case "delete":
		return "delete"
	case "delete,create", "create,delete":
		return "replace"
	}
	return ""
}

// SummarizePlan builds a PlanDetail from `terraform show -json` output.
func SummarizePlan(planJSON []byte) (*PlanDetail, error) {
	var plan struct {
		TerraformVersion string `json:"terraform_version"`
		ResourceChanges  []struct {
			Address       string `json:"address"`
			ModuleAddress string `json:"module_address"`
			Mode          string `json:"mode"`
			Type          string `json:"type"`
			ActionReason  string `json:"action_reason"`
			Change        struct {
				Actions []string `json:"actions"`
			} `json:"change"`
		} `json:"resource_changes"`
	}
	if err := json.Unmarshal(planJSON, &plan); err != nil {
		return nil, fmt.Errorf("plan JSON: %w", err)
	}
	d := &PlanDetail{Format: plan.TerraformVersion}
	for _, rc := range plan.ResourceChanges {
		if rc.Mode != "managed" {
			continue
		}
		action := actionOf(rc.Change.Actions)
		switch action {
		case "":
			continue
		case "create":
			d.Summary.Add++
		case "update":
			d.Summary.Change++
		case "delete":
			d.Summary.Destroy++
		case "replace":
			d.Summary.Add++
			d.Summary.Destroy++
		}
		c := PlanChange{Address: rc.Address, Type: rc.Type, Module: rc.ModuleAddress, Action: action}
		if action == "replace" {
			c.Reason = rc.ActionReason
		}
		d.Changes = append(d.Changes, c)
	}

	byGroup := map[string][]PlanChange{}
	for _, c := range d.Changes {
		g := groupOf(c.Type)
		byGroup[g] = append(byGroup[g], c)
	}
	for _, name := range groupOrder {
		changes := byGroup[name]
		if len(changes) == 0 {
			continue
		}
		sort.Slice(changes, func(i, j int) bool { return changes[i].Address < changes[j].Address })
		d.Groups = append(d.Groups, PlanGroup{Name: name, Changes: changes})
	}
	return d, nil
}

func (s *Store) planKey(name, id string) string {
	return Prefix + name + "/plans/" + id + ".json"
}

// PutPlan stores a plan run's detail next to the run.
func (s *Store) PutPlan(ctx context.Context, env, id string, d *PlanDetail) error {
	return s.putJSON(ctx, s.planKey(env, id), d)
}

func (s *Store) GetPlan(ctx context.Context, env, id string) (*PlanDetail, error) {
	if !ValidName(env) || !validRunID.MatchString(id) {
		return nil, fmt.Errorf("invalid environment or run id")
	}
	b, err := s.get(ctx, s.planKey(env, id))
	if err != nil {
		return nil, err
	}
	var d PlanDetail
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	return &d, nil
}
