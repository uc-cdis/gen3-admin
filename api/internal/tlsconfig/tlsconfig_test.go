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

// The point of this package: a name mismatch is tolerated, but an untrusted
// chain is not. InsecureSkipVerify alone would have accepted both.
func TestBuildVerifiesChainWhileSkippingHostname(t *testing.T) {
	cfg := build()

	if cfg.VerifyConnection == nil {
		t.Fatal("build() returned no VerifyConnection; an untrusted chain would be accepted")
	}
	if cfg.RootCAs == nil {
		t.Error("build() returned no RootCAs")
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Errorf("MinVersion = %d, want TLS 1.2", cfg.MinVersion)
	}
}

func TestVerifyConnectionRejectsEmptyPeerChain(t *testing.T) {
	cfg := build()
	err := cfg.VerifyConnection(tls.ConnectionState{})
	if err == nil {
		t.Error("VerifyConnection accepted a connection with no peer certificate")
	}
}

func TestVerifyConnectionRejectsUntrustedChain(t *testing.T) {
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
	t.Setenv(envInsecure, "")

	cfg := build()
	if cfg.RootCAs == nil {
		t.Fatal("no RootCAs built")
	}
	// The operator-supplied CA should now be a trusted root.
	if len(cfg.RootCAs.Subjects()) == 0 { //nolint:staticcheck // fine for a pool we built
		t.Error("extra CA file was not added to the pool")
	}
}

// The escape hatch must still work, and must be explicit.
func TestInsecureOptOut(t *testing.T) {
	t.Setenv(envInsecure, "true")
	cfg := build()

	if !cfg.InsecureSkipVerify {
		t.Error("INTRACLUSTER_TLS_INSECURE=true did not disable verification")
	}
	if cfg.VerifyConnection != nil {
		t.Error("opt-out should not also install a verifier")
	}
}

func TestDefaultIsNotBlanketInsecure(t *testing.T) {
	t.Setenv(envInsecure, "")
	cfg := build()

	// InsecureSkipVerify is set, but only because VerifyConnection does the
	// checking. Without the verifier that combination would be unsafe.
	if cfg.InsecureSkipVerify && cfg.VerifyConnection == nil {
		t.Error("verification is disabled with no replacement verifier")
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
