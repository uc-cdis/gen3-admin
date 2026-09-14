// Package tlsconfig builds the TLS configuration for intra-cluster HTTP hops.
package tlsconfig

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"sync"
)

// The CA the kubelet projects into every pod. Services fronted by the cluster's
// own CA verify against this.
const serviceAccountCAPath = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"

// Set INTRACLUSTER_TLS_CA_FILE to trust an additional CA bundle, or
// INTRACLUSTER_TLS_INSECURE=true to fall back to the previous behaviour of
// skipping verification entirely (development only).
const (
	envExtraCAFile = "INTRACLUSTER_TLS_CA_FILE"
	envInsecure    = "INTRACLUSTER_TLS_INSECURE"
)

var (
	once   sync.Once
	cached *tls.Config
)

// IntraCluster returns the TLS config for a hop to an in-cluster service.
//
// These targets (ArgoCD among them) commonly serve certificates issued by the
// cluster CA rather than a public one, and are reached by Service DNS or a
// loopback port-forward, so the name in the certificate frequently will not
// match the address dialled. The previous config set InsecureSkipVerify, which
// also switched off chain verification and left the hop open to an in-cluster
// MITM.
//
// Instead the chain is verified against the cluster CA (plus the system pool
// and any operator-supplied bundle) while hostname checking is delegated to
// VerifyConnection, which validates the chain but not the name. That keeps the
// property the deployment actually needs -- tolerating a name mismatch --
// without accepting arbitrary certificates.
func IntraCluster() *tls.Config {
	once.Do(func() { cached = build() })
	return cached.Clone()
}

func build() *tls.Config {
	if os.Getenv(envInsecure) == "true" {
		// Explicit opt-out for a cluster whose services use certificates from
		// an unavailable CA.
		return &tls.Config{InsecureSkipVerify: true} // #nosec G402 -- opt-in via INTRACLUSTER_TLS_INSECURE
	}

	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	for _, path := range []string{serviceAccountCAPath, os.Getenv(envExtraCAFile)} {
		if path == "" {
			continue
		}
		if pem, err := os.ReadFile(path); err == nil {
			pool.AppendCertsFromPEM(pem)
		}
	}

	return &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    pool,
		// Skip the built-in check so a name mismatch is tolerated, then verify
		// the chain explicitly below. This is not InsecureSkipVerify in effect:
		// an untrusted chain is still rejected.
		InsecureSkipVerify: true, // #nosec G402 -- chain verified in VerifyConnection
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return fmt.Errorf("no peer certificate presented")
			}
			opts := x509.VerifyOptions{
				Roots:         pool,
				Intermediates: x509.NewCertPool(),
				// DNSName intentionally empty: the name is not checked.
			}
			for _, cert := range cs.PeerCertificates[1:] {
				opts.Intermediates.AddCert(cert)
			}
			if _, err := cs.PeerCertificates[0].Verify(opts); err != nil {
				return fmt.Errorf("intra-cluster TLS chain verification failed: %w", err)
			}
			return nil
		},
	}
}
