package agentHelper

import "testing"

func TestValidateProxyTargetAllowsClusterInternal(t *testing.T) {
	allowed := []string{
		"http://argocd-server.argocd.svc/api/v1/session",
		"https://argocd-server.argocd.svc.cluster.local:443/api/v1/applications",
		"http://gen3-elasticsearch-master.default.svc:9200/_cat/indices",
		"http://argocd-server/api/v1/version", // single-label: same-namespace service
		"http://localhost:8080/healthz",
		"http://127.0.0.1:9200/",
	}

	for _, raw := range allowed {
		if _, err := validateProxyTarget(raw); err != nil {
			t.Errorf("validateProxyTarget(%q) = %v, want allowed", raw, err)
		}
	}
}

func TestValidateProxyTargetBlocksExternal(t *testing.T) {
	// The agent runs inside the cluster with broad credentials, so an
	// unrestricted proxy is an SSRF primitive. Cloud instance-metadata is the
	// case that matters most.
	blocked := []string{
		"http://169.254.169.254/latest/meta-data/iam/security-credentials/",
		"http://metadata.google.internal/computeMetadata/v1/",
		"https://evil.example.com/collect",
		"http://10.0.0.5:8080/internal",
	}

	for _, raw := range blocked {
		if _, err := validateProxyTarget(raw); err == nil {
			t.Errorf("validateProxyTarget(%q) = nil, want blocked", raw)
		}
	}
}

func TestValidateProxyTargetRejectsBadURLs(t *testing.T) {
	bad := []string{
		"",                        // no host
		"file:///etc/passwd",      // non-HTTP scheme
		"gopher://evil.test/",     // non-HTTP scheme
		"ftp://files.example.com", // non-HTTP scheme
	}

	for _, raw := range bad {
		if _, err := validateProxyTarget(raw); err == nil {
			t.Errorf("validateProxyTarget(%q) = nil, want error", raw)
		}
	}
}

func TestValidateProxyTargetHonoursAllowlist(t *testing.T) {
	const target = "https://argo.example.com/api/v1/session"

	if _, err := validateProxyTarget(target); err == nil {
		t.Fatal("expected external host to be blocked by default")
	}

	t.Setenv("GEN3_PROXY_ALLOWLIST", "other.example.com, argo.example.com")
	if _, err := validateProxyTarget(target); err != nil {
		t.Errorf("validateProxyTarget with allowlist = %v, want allowed", err)
	}
}

func TestValidateProxyTargetEscapeHatch(t *testing.T) {
	const target = "https://anything.example.com/"

	if _, err := validateProxyTarget(target); err == nil {
		t.Fatal("expected external host to be blocked by default")
	}

	t.Setenv("GEN3_PROXY_ALLOW_EXTERNAL", "true")
	if _, err := validateProxyTarget(target); err != nil {
		t.Errorf("validateProxyTarget with escape hatch = %v, want allowed", err)
	}
}

func TestValidateProxyTargetPreservesPathAndQuery(t *testing.T) {
	target, err := validateProxyTarget("http://argocd-server.argocd.svc/api/v1/applications?appNamespace=argocd")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if target.Path != "/api/v1/applications" {
		t.Errorf("path = %q, want /api/v1/applications", target.Path)
	}
	if got := target.Query().Get("appNamespace"); got != "argocd" {
		t.Errorf("appNamespace = %q, want argocd", got)
	}
}
