package tlsconfig

import (
	"crypto/tls"
	"testing"
)

// The agent↔server gRPC channel builds its own tls.Config with client
// certificates and RequireAndVerifyClientCert (internal/ca for the server,
// NewAgent for the client). This package must stay out of that path: it is for
// outbound server-auth HTTP hops only.
//
// This test documents the boundary so a future change that wires IntraCluster()
// into the gRPC credentials fails here rather than in production, where it
// would silently drop the client certificate and break agent authentication.
func TestIntraClusterIsNotAnMTLSConfig(t *testing.T) {
	for _, mode := range []string{"", "true"} {
		t.Setenv(envVerify, mode)
		cfg := IntraCluster()

		if len(cfg.Certificates) != 0 || cfg.GetClientCertificate != nil {
			t.Errorf("verify=%q: IntraCluster() presents a client certificate; "+
				"it is server-auth only and must not be used for mTLS", mode)
		}
		if cfg.ClientAuth != tls.NoClientCert {
			t.Errorf("verify=%q: ClientAuth = %v, want NoClientCert "+
				"(this is a client config, not a server one)", mode, cfg.ClientAuth)
		}
		if cfg.ClientCAs != nil {
			t.Errorf("verify=%q: ClientCAs is set on a client config", mode)
		}
	}
}
