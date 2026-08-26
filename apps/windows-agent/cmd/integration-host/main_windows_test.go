//go:build windows

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLoopbackDeviceResolverRejectsNonLoopbackPeer(t *testing.T) {
	resolver := loopbackDeviceResolver("local-integration-device")
	request := httptest.NewRequest("GET", "https://127.0.0.1/terminal", nil)
	request.RemoteAddr = "192.0.2.10:443"
	if _, err := resolver(request); err == nil {
		t.Fatal("non-loopback peer was accepted")
	}
	request.RemoteAddr = "127.0.0.1:443"
	identity, err := resolver(request)
	if err != nil || identity != "local-integration-device" {
		t.Fatalf("loopback identity resolution failed: %q, %v", identity, err)
	}
}

func TestVerifyCertificateRejectsUntrustedSelfSignedCertificate(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "integration.invalid"}, DNSNames: []string{"integration.invalid"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true, IsCA: true}
	der, err := x509.CreateCertificate(rand.Reader, template, template, publicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyCertificate(tlsCertificateForTest(der), "integration.invalid"); err == nil {
		t.Fatal("untrusted self-signed certificate was accepted")
	}
}

func tlsCertificateForTest(der []byte) tls.Certificate {
	return tls.Certificate{Certificate: [][]byte{der}}
}
