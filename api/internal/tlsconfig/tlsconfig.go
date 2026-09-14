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

const (
	// INTRACLUSTER_TLS_CA_FILE adds a CA bundle to the trust pool.
	envExtraCAFile = "INTRACLUSTER_TLS_CA_FILE"
	// INTRACLUSTER_TLS_VERIFY=true turns on chain verification. Off by default
	// -- see IntraCluster.
	envVerify = "INTRACLUSTER_TLS_VERIFY"
)

var (
	once   sync.Once
	cached *tls.Config
)

// IntraCluster returns the TLS config for a hop to an in-cluster service.
//
// These hops reach arbitrary in-cluster services over https, and those serve
// certificates from whatever issuer happens to be in play: ArgoCD self-signs at
// install time, cert-manager issues from its own CA, and this project's own CA
// (internal/ca) signs others. None of them chain to the projected
// serviceaccount CA, and nothing in the repo distributes their roots. The
// targets are also addressed by Service DNS or a loopback port-forward, so the
// name in the certificate routinely will not match the address dialled.
//
// Verification is therefore off by default: turning it on unconditionally would
// break every one of those hops, including the ArgoCD path that is the main
// caller. Set INTRACLUSTER_TLS_VERIFY=true (optionally with
// INTRACLUSTER_TLS_CA_FILE pointing at the issuing CA) in a deployment where
// the in-cluster issuers are known and distributed; the chain is then verified
// while the hostname check stays off, which is the part these hops genuinely
// cannot satisfy.
//
// The residual risk in the default mode is an in-cluster MITM. That is the
// same exposure this code has always had; it is recorded here rather than
// silently inherited.
func IntraCluster() *tls.Config {
	once.Do(func() { cached = build() })
	return cached.Clone()
}

func build() *tls.Config {
	if os.Getenv(envVerify) != "true" {
		// Default: accept any certificate, as before. mTLS is unaffected --
		// this config carries no client certificates and is not used by the
		// agent gRPC channel (see internal/ca and NewAgent).
		return &tls.Config{
			MinVersion:         tls.VersionTLS12,
			InsecureSkipVerify: true, // #nosec G402 -- in-cluster hop to a self-signed target; opt in with INTRACLUSTER_TLS_VERIFY
		}
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
