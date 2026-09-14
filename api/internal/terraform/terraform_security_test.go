package terraform

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveWorkDirRejectsEscapes(t *testing.T) {
	cases := []string{
		"/etc",
		"/etc/cron.d",
		"../../../etc",
		"foo/../../etc",
		"foo/bar",
		`foo\bar`,
		"foo; rm -rf /",
		"foo$(id)",
		"foo`id`",
		"foo bar",
		"..",
		".",
		"~",
	}
	for _, in := range cases {
		got, err := resolveWorkDir(in)
		if err == nil {
			t.Errorf("resolveWorkDir(%q) = %q, want error", in, got)
		}
	}
}

func TestResolveWorkDirConfinesToRoot(t *testing.T) {
	t.Setenv("TERRAFORM_WORK_ROOT", "/srv/tf")

	for _, in := range []string{"", "  "} {
		got, err := resolveWorkDir(in)
		if err != nil {
			t.Fatalf("resolveWorkDir(%q) errored: %v", in, err)
		}
		if got != "/srv/tf" {
			t.Errorf("resolveWorkDir(%q) = %q, want the root", in, got)
		}
	}

	got, err := resolveWorkDir("project-a_1")
	if err != nil {
		t.Fatalf("resolveWorkDir rejected a valid name: %v", err)
	}
	if got != "/srv/tf/project-a_1" {
		t.Errorf("resolveWorkDir = %q, want /srv/tf/project-a_1", got)
	}
	if !strings.HasPrefix(filepath.Clean(got), "/srv/tf/") {
		t.Errorf("resolved path %q escaped the root", got)
	}
}

// The UI sends the root back verbatim; that must keep working.
func TestResolveWorkDirAcceptsRootEcho(t *testing.T) {
	t.Setenv("TERRAFORM_WORK_ROOT", "/srv/tf")

	got, err := resolveWorkDir("/srv/tf")
	if err != nil {
		t.Fatalf("resolveWorkDir rejected the root itself: %v", err)
	}
	if got != "/srv/tf" {
		t.Errorf("resolveWorkDir = %q, want /srv/tf", got)
	}

	got, err = resolveWorkDir("/srv/tf/envA")
	if err != nil {
		t.Fatalf("resolveWorkDir rejected a root-prefixed name: %v", err)
	}
	if got != "/srv/tf/envA" {
		t.Errorf("resolveWorkDir = %q, want /srv/tf/envA", got)
	}
}

// Defaulting must match what the UI ships out of the box.
func TestResolveWorkDirDefaultRootMatchesUI(t *testing.T) {
	got, err := resolveWorkDir("/tmp/gen3-terraform")
	if err != nil {
		t.Fatalf("resolveWorkDir rejected the UI default: %v", err)
	}
	if got != "/tmp/gen3-terraform" {
		t.Errorf("resolveWorkDir = %q, want /tmp/gen3-terraform", got)
	}
}

func TestSafeTFVarsNameRejectsTraversal(t *testing.T) {
	cases := []string{
		"../../etc/passwd.tfvars",
		"/etc/passwd.tfvars",
		"sub/dir.tfvars",
		`..\\win.tfvars`,
		"..",
		".",
	}
	for _, in := range cases {
		if got, err := safeTFVarsName(in); err == nil {
			t.Errorf("safeTFVarsName(%q) = %q, want error", in, got)
		}
	}
}

func TestSafeTFVarsNameRequiresTFVarsSuffix(t *testing.T) {
	for _, in := range []string{"passwd", "id_rsa", "shell.sh", "x.tfvars.bak"} {
		if got, err := safeTFVarsName(in); err == nil {
			t.Errorf("safeTFVarsName(%q) = %q, want error", in, got)
		}
	}
}

func TestSafeTFVarsNameAcceptsValid(t *testing.T) {
	cases := map[string]string{
		"":              "terraform.tfvars",
		"prod.tfvars":   "prod.tfvars",
		"a.tfvars.json": "a.tfvars.json",
	}
	for in, want := range cases {
		got, err := safeTFVarsName(in)
		if err != nil {
			t.Errorf("safeTFVarsName(%q) errored: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("safeTFVarsName(%q) = %q, want %q", in, got, want)
		}
	}
}
