package ca

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uc-cdis/gen3-admin/internal/utils"
	"google.golang.org/grpc/credentials"
)

var (
	certCurve = elliptic.P384()
)

const (
	// Read from ENV fall back to these
	caCertFile = "certs/ca.crt"
	caKeyFile  = "certs/ca.key"
)

func LoadOrCreateServerCert(caCert *x509.Certificate, caKey *ecdsa.PrivateKey, serverCertFile string, serverKeyFile string) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	if _, err := os.Stat(serverCertFile); err == nil {
		serverCertPEM, _ := pem.Decode(utils.MustReadFile(serverCertFile))
		serverKeyPEM, _ := pem.Decode(utils.MustReadFile(serverKeyFile))

		serverCert, err := x509.ParseCertificate(serverCertPEM.Bytes)
		if err != nil {
			return nil, nil, fmt.Errorf("error parsing server certificate: %v", err)
		}

		serverKey, err := x509.ParseECPrivateKey(serverKeyPEM.Bytes)
		if err != nil {
			return nil, nil, fmt.Errorf("error parsing server key: %v", err)
		}

		return serverCert, serverKey, nil
	}

	serverPrivKey, err := ecdsa.GenerateKey(certCurve, rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("error generating server key: %v", err)
	}

	// Generate a Certificate Signing Request (CSR)
	serverTemplate := &x509.CertificateRequest{
		Subject:  pkix.Name{CommonName: "csoc.gen3.org"}, // TODO: Change the CommonName
		DNSNames: []string{"localhost", "csoc.gen3.org"},
	}
	csrBytes, err := x509.CreateCertificateRequest(rand.Reader, serverTemplate, serverPrivKey)
	if err != nil {
		return nil, nil, fmt.Errorf("error creating certificate request: %v", err)
	}
	csr, err := x509.ParseCertificateRequest(csrBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("error parsing certificate request: %v", err)
	}

	// Sign the CSR with the CA
	serverCertTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      csr.Subject,
		NotBefore:    time.Now(),
		NotAfter:     time.Now().AddDate(10, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     csr.DNSNames,
	}
	serverCertBytes, err := x509.CreateCertificate(rand.Reader, serverCertTemplate, caCert, &serverPrivKey.PublicKey, caKey)
	if err != nil {
		return nil, nil, fmt.Errorf("error creating server certificate: %v", err)
	}

	serverKeyBytes, err := x509.MarshalECPrivateKey(serverPrivKey)
	if err != nil {
		return nil, nil, fmt.Errorf("error marshaling server key: %v", err)
	}

	serverCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverCertBytes})
	serverKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyBytes})

	// Write certificate and key to file
	utils.MustWriteFile(serverCertFile, serverCertPEM, 0644)
	utils.MustWriteFile(serverKeyFile, serverKeyPEM, 0600)

	log.Debug().Msgf("Certificate and key for server dumped to file")

	// _, err = db.Exec("INSERT INTO server (certificate, private_key) VALUES (?, ?)", serverCertPEM, serverKeyPEM)
	// if err != nil {
	// 	return nil, nil, fmt.Errorf("error registering server in database: %v", err)
	// }

	serverCert, err := x509.ParseCertificate(serverCertBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("error parsing server certificate after creation: %v", err)
	}

	return serverCert, serverPrivKey, nil
}

func LoadOrCreateCA() (*x509.Certificate, *ecdsa.PrivateKey, error) {
	if _, err := os.Stat(caCertFile); err == nil {
		caCertPEM, _ := pem.Decode(utils.MustReadFile(caCertFile))
		caKeyPEM, _ := pem.Decode(utils.MustReadFile(caKeyFile))

		caCert, err := x509.ParseCertificate(caCertPEM.Bytes)
		if err != nil {
			return nil, nil, fmt.Errorf("error parsing CA certificate: %v", err)
		}

		caKey, err := x509.ParseECPrivateKey(caKeyPEM.Bytes)
		if err != nil {
			return nil, nil, fmt.Errorf("error parsing CA key: %v", err)
		}

		return caCert, caKey, nil
	}

	caPrivKey, err := ecdsa.GenerateKey(certCurve, rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("error generating CA key: %v", err)
	}

	serialNumber := big.NewInt(1)
	caTemplate := &x509.Certificate{
		SerialNumber: serialNumber, // Use a cryptographically secure random serial number
		Subject: pkix.Name{
			CommonName:         "CSOC Gen3 Root CA",
			Organization:       []string{"CSOC Organization"},
			OrganizationalUnit: []string{"CSOC Gen3 Root Certificate Authority"},
			Country:            []string{"US"},
		},
		NotBefore:             time.Now().Add(-10 * time.Minute), // Start slightly in the past
		NotAfter:              time.Now().AddDate(10, 0, 0),      // 10 years validity
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
		MaxPathLen:            0, // Restrict the CA from issuing intermediate CAs
	}

	caCertBytes, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caPrivKey.PublicKey, caPrivKey)
	if err != nil {
		return nil, nil, fmt.Errorf("error creating CA certificate: %v", err)
	}

	caKeyBytes, err := x509.MarshalECPrivateKey(caPrivKey)
	if err != nil {
		return nil, nil, fmt.Errorf("error marshaling CA key: %v", err)
	}

	// Make sure the CA directory exists
	os.MkdirAll("certs", 0755)

	utils.MustWriteFile(caCertFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCertBytes}), 0644)
	utils.MustWriteFile(caKeyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: caKeyBytes}), 0600)

	return caTemplate, caPrivKey, nil
}

func SetupCerts() (*credentials.TransportCredentials, error) {
	// Load CA certificate and server credentials
	caCert, caKey, err := LoadOrCreateCA()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to read CA certificate")
	}
	certPool := x509.NewCertPool()
	certPool.AddCert(caCert)

	// serverCert, err := tls.LoadX509KeyPair("server.crt", "server.key")
	serverCert, serverKey, err := LoadOrCreateServerCert(caCert, caKey, "certs/server.crt", "certs/server.key")
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load server certificate and key")
	}

	// Marshal the ECDSA private key
	serverKeyBytes, err := x509.MarshalECPrivateKey(serverKey)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to marshal ECDSA private key")
	}

	// Create a tls.Certificate from the x509.Certificate and the private key bytes
	tlsCert, err := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverCert.Raw}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyBytes}))

	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create TLS certificate")
	}

	creds := credentials.NewTLS(&tls.Config{
		ClientAuth:   tls.RequireAndVerifyClientCert,
		Certificates: []tls.Certificate{tlsCert},
		ClientCAs:    certPool,
	})
	return &creds, nil
}
