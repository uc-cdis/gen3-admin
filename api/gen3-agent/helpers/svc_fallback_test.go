package agentHelper

import "testing"

func TestParseClusterServiceHost(t *testing.T) {
	cases := []struct {
		url     string
		ok      bool
		svc, ns string
		port    int
	}{
		{"http://argocd-server.argocd.svc", true, "argocd-server", "argocd", 80},
		{"https://argocd-server.argocd.svc", true, "argocd-server", "argocd", 443},
		{"http://argocd-server.argocd.svc:8080", true, "argocd-server", "argocd", 8080},
		{"http://argocd-server.argocd.svc.cluster.local", true, "argocd-server", "argocd", 80},
		{"http://localhost:18443", false, "", "", 0},
		{"http://127.0.0.1:9200", false, "", "", 0},
		{"https://mimir.planx-pla.net/x", false, "", "", 0},
		{"http://argocd-server.svc", false, "", "", 0},
	}
	for _, c := range cases {
		got, ok := parseClusterServiceHost(c.url)
		if ok != c.ok {
			t.Errorf("%s: ok=%v want %v", c.url, ok, c.ok)
			continue
		}
		if !ok {
			continue
		}
		if got.Service != c.svc || got.Namespace != c.ns || got.Port != c.port {
			t.Errorf("%s: got %+v want %s/%s:%d", c.url, got, c.ns, c.svc, c.port)
		} else {
			t.Logf("%-52s -> %s/%s:%d", c.url, got.Namespace, got.Service, got.Port)
		}
	}
}
