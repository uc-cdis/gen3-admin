package gitops

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/uc-cdis/gen3-admin/internal/environments"
)

// RepoOf is the GitOps repo an environment is connected to.
func RepoOf(e *environments.Environment) (Repo, error) {
	if e.GitOps == nil {
		return Repo{}, fmt.Errorf("environment %s has no GitOps repo connected", e.Name)
	}
	return Repo{Owner: e.GitOps.Owner, Name: e.GitOps.Repo, BaseBranch: e.GitOps.BaseBranch}, nil
}

// CSOCInputsFor builds the render inputs for a CSOC environment from its
// Terraform outputs, its install settings and its repo. The allowlist is
// the operator's CIDRs plus the cluster's egress IP, once the install has
// found it.
func CSOCInputsFor(e *environments.Environment, bucket string) (CSOCInputs, error) {
	if e.Kind != environments.KindCSOC {
		return CSOCInputs{}, fmt.Errorf("environment %s is a %s, not a CSOC", e.Name, e.Kind)
	}
	// Without a repo the CSOC is installed directly, and can be connected
	// to one later.
	var repo Repo
	if e.GitOps != nil {
		repo, _ = RepoOf(e)
	}
	if e.Install == nil {
		return CSOCInputs{}, fmt.Errorf("environment %s has no install settings", e.Name)
	}
	str := func(name string) string {
		var s string
		_ = json.Unmarshal(e.Outputs[name], &s)
		return s
	}
	required := []string{"cluster_name", "aws_region", "vpc_id", "lb_controller_role_arn",
		"external_secrets_role_arn", "csoc_api_role_arn", "certificate_arn", "csoc_hostname", "keycloak_hostname"}
	var missing []string
	for _, name := range required {
		if str(name) == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return CSOCInputs{}, fmt.Errorf("environment %s is missing terraform outputs %s; apply it with a module version that has them",
			e.Name, strings.Join(missing, ", "))
	}
	cidrs := append([]string{}, e.Install.AllowedCIDRs...)
	if e.Install.EgressIP != "" {
		cidrs = append(cidrs, e.Install.EgressIP+"/32")
	}
	email := e.Install.AdminEmail
	if email == "" {
		email = "admin@" + str("csoc_hostname")
	}
	in := CSOCInputs{
		Name:          e.Name,
		Repo:          repo,
		Region:        str("aws_region"),
		ClusterName:   str("cluster_name"),
		VPCID:         str("vpc_id"),
		LBRoleARN:     str("lb_controller_role_arn"),
		ESORoleARN:    str("external_secrets_role_arn"),
		APIRoleARN:    str("csoc_api_role_arn"),
		CertARN:       str("certificate_arn"),
		CSOCHost:      str("csoc_hostname"),
		KeycloakHost:  str("keycloak_hostname"),
		StateBucket:   bucket,
		AdminEmail:    email,
		AllowedCIDRs:  cidrs,
		APIImage:      SplitImage(e.Install.APIImage),
		FrontendImage: SplitImage(e.Install.FrontendImage),
		Chart:         DefaultChart(),
		Versions:      DefaultVersions,
	}
	return in, in.Validate()
}
