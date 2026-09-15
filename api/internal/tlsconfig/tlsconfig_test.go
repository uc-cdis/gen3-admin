package tlsconfig

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Default mode must not verify. In-cluster targets self-sign (ArgoCD) or use
// issuers whose roots are not distributed, so verifying by default would break
// every hop this config is used for.
func TestDefaultDoesNotVerify(t *testing.T) {
	t.Setenv(envVerify, "")
	cfg := build()

	if !cfg.InsecureSkipVerify {
		t.Error("default mode verifies; this breaks hops to self-signed in-cluster services")
	}
	if cfg.VerifyConnection != nil {
		t.Error("default mode installed a chain verifier")
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Errorf("MinVersion = %d, want TLS 1.2", cfg.MinVersion)
	}
}

// Opt-in mode: a name mismatch is tolerated, but an untrusted chain is not.
func TestVerifyModeChecksChainButNotHostname(t *testing.T) {
	t.Setenv(envVerify, "true")
	cfg := build()

	if cfg.VerifyConnection == nil {
		t.Fatal("verify mode returned no VerifyConnection; an untrusted chain would be accepted")
	}
	if cfg.RootCAs == nil {
		t.Error("verify mode returned no RootCAs")
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Errorf("MinVersion = %d, want TLS 1.2", cfg.MinVersion)
	}
}

func TestVerifyConnectionRejectsEmptyPeerChain(t *testing.T) {
	t.Setenv(envVerify, "true")
	cfg := build()
	err := cfg.VerifyConnection(tls.ConnectionState{})
	if err == nil {
		t.Error("VerifyConnection accepted a connection with no peer certificate")
	}
}

func TestVerifyConnectionRejectsUntrustedChain(t *testing.T) {
	t.Setenv(envVerify, "true")
	cfg := build()

	// A self-signed cert from a CA that is not in the pool must be rejected.
	cert := selfSignedCert(t)
	err := cfg.VerifyConnection(tls.ConnectionState{
		PeerCertificates: []*x509.Certificate{cert},
	})
	if err == nil {
		t.Error("VerifyConnection accepted an untrusted self-signed certificate")
	}
}

func TestExtraCAFileIsTrusted(t *testing.T) {
	dir := t.TempDir()
	caPath := filepath.Join(dir, "ca.pem")
	caPEM, _ := selfSignedCAPEM(t)
	if err := os.WriteFile(caPath, caPEM, 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv(envExtraCAFile, caPath)
	t.Setenv(envVerify, "true")

	cfg := build()
	if cfg.RootCAs == nil {
		t.Fatal("no RootCAs built")
	}
	// The operator-supplied CA should now be a trusted root.
	if len(cfg.RootCAs.Subjects()) == 0 { //nolint:staticcheck // fine for a pool we built
		t.Error("extra CA file was not added to the pool")
	}
}

// Only the exact string "true" turns verification on, so a typo fails safe
// toward today's working behaviour rather than breaking every hop.
func TestVerifyRequiresExactTrue(t *testing.T) {
	for _, v := range []string{"", "1", "yes", "TRUE", "on"} {
		t.Setenv(envVerify, v)
		if cfg := build(); cfg.VerifyConnection != nil {
			t.Errorf("INTRACLUSTER_TLS_VERIFY=%q enabled verification", v)
		}
	}
}

// This config is for server-auth hops only. If it ever carried client
// certificates it would start participating in mTLS, which is handled
// separately in internal/ca and NewAgent.
func TestNoClientCertificatesInEitherMode(t *testing.T) {
	for _, v := range []string{"", "true"} {
		t.Setenv(envVerify, v)
		cfg := build()
		if len(cfg.Certificates) != 0 {
			t.Errorf("verify=%q: config carries client certificates", v)
		}
		if cfg.GetClientCertificate != nil {
			t.Errorf("verify=%q: config sets GetClientCertificate", v)
		}
	}
}

func TestIntraClusterReturnsIndependentClones(t *testing.T) {
	a := IntraCluster()
	b := IntraCluster()

	if a == b {
		t.Error("IntraCluster() returned the same pointer twice; a caller could mutate shared state")
	}
	a.ServerName = "mutated"
	if b.ServerName == "mutated" {
		t.Error("mutating one config affected another")
	}
}

// --- helpers ---

func selfSignedCAPEM(t *testing.T) ([]byte, *x509.Certificate) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), cert
}

func selfSignedCert(t *testing.T) *x509.Certificate {
	t.Helper()
	_, cert := selfSignedCAPEM(t)
	return cert
}
