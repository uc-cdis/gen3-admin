package keycloak

import "testing"

// Some agent-scoped routes are GETs only because of how their protocol is
// established, but confer the power of a write. Authorizing them on the HTTP
// method alone let a <agent>-read holder open an interactive root shell in
// any pod -- and the agent's ServiceAccount is bound to cluster-admin, so
// that is unrestricted access to the cluster.
func TestRequiresWriteDespiteGET(t *testing.T) {
	writeEquivalent := []string{
		"/api/agents/dev0/terminal/exec/default/mypod/app",
		"/api/agents/dev0/terminal/test",
		"/api/agents/dev0/tunnel/abc123/http",
		"/api/agents/prod-cluster/terminal/exec/kube-system/coredns/coredns",
	}
	for _, url := range writeEquivalent {
		if !requiresWriteDespiteGET(url) {
			t.Errorf("requiresWriteDespiteGET(%q) = false; a read role would grant a shell", url)
		}
	}
}

// Genuine reads must stay on the read role, or every viewer loses the console.
func TestOrdinaryReadsAreNotWriteEquivalent(t *testing.T) {
	reads := []string{
		"/api/k8s/dev0/proxy/api/v1/pods",
		"/api/k8s/dev0/proxy/apis/apps/v1/deployments",
		"/api/agents/dev0/helm/list",
		"/api/argocd/dev0/applications",
		"/api/agents",
		"/api/me",
	}
	for _, url := range reads {
		if requiresWriteDespiteGET(url) {
			t.Errorf("requiresWriteDespiteGET(%q) = true; read-only users would lose this view", url)
		}
	}
}

// A resource whose *name* contains a marker must not be mistaken for the
// route: a pod called "tunnel-proxy" is still just a pod.
func TestNamesContainingMarkersAreNotMatched(t *testing.T) {
	notRoutes := []string{
		"/api/k8s/dev0/proxy/api/v1/namespaces/default/pods/my-terminal-exec-pod",
		"/api/k8s/dev0/proxy/api/v1/namespaces/default/configmaps/terminal-exec",
	}
	for _, url := range notRoutes {
		if requiresWriteDespiteGET(url) {
			t.Errorf("requiresWriteDespiteGET(%q) = true; this is a named object, not the route", url)
		}
	}
}
