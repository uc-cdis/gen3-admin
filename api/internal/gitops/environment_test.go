package gitops

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/uc-cdis/gen3-admin/internal/environments"
)

func csocEnv() *environments.Environment {
	out := map[string]string{
		"cluster_name":              "csoc-dev",
		"aws_region":                "us-east-1",
		"vpc_id":                    "vpc-0123456789abcdef0",
		"lb_controller_role_arn":    "arn:aws:iam::123456789012:role/csoc-dev-lb-controller",
		"external_secrets_role_arn": "arn:aws:iam::123456789012:role/csoc-dev-external-secrets",
		"csoc_api_role_arn":         "arn:aws:iam::123456789012:role/csoc-dev-csoc-api",
		"certificate_arn":           "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555",
		"csoc_hostname":             "csoc.example.org",
		"keycloak_hostname":         "auth.csoc.example.org",
	}
	e := &environments.Environment{
		Name: "csoc-dev", Kind: environments.KindCSOC, Outputs: map[string]json.RawMessage{},
		GitOps:  &environments.GitOps{Owner: "o", Repo: "r", BaseBranch: "main"},
		Install: &environments.Install{AllowedCIDRs: []string{"203.0.113.7/32"}, EgressIP: "192.0.2.9"},
	}
	for k, v := range out {
		b, _ := json.Marshal(v)
		e.Outputs[k] = b
	}
	return e
}

func TestCSOCInputsFor(t *testing.T) {
	in, err := CSOCInputsFor(csocEnv(), "state-bucket")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(in.AllowedCIDRs, ",") != "192.0.2.9/32,203.0.113.7/32" {
		t.Errorf("allowlist = %v, want the operator's CIDR plus the egress IP", in.AllowedCIDRs)
	}
	if in.AdminEmail != "admin@csoc.example.org" || in.Repo.CloneURL() != "https://github.com/o/r.git" {
		t.Errorf("inputs = %+v", in)
	}
	if _, err := RenderCSOC(in); err != nil {
		t.Fatal(err)
	}

	noRepo := csocEnv()
	noRepo.GitOps = nil
	direct, err := CSOCInputsFor(noRepo, "state-bucket")
	if err != nil || !direct.Direct() {
		t.Errorf("without a repo: direct=%v err=%v, want a direct install", direct.Direct(), err)
	}
	commons := csocEnv()
	commons.Kind = environments.KindCommons
	if _, err := CSOCInputsFor(commons, "state-bucket"); err == nil {
		t.Error("rendered a commons as a CSOC")
	}
}
