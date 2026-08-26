//go:build windows

package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net/http"
	"testing"
	"time"
)

func TestValidateLoopbackAddressRejectsBeforeBind(t *testing.T) {
	if _, err := validateLoopbackAddress("0.0.0.0:0"); err == nil {
		t.Fatal("wildcard listener was accepted")
	}
	if _, err := validateLoopbackAddress("192.0.2.10:0"); err == nil {
		t.Fatal("LAN listener was accepted")
	}
	address, err := validateLoopbackAddress("127.0.0.1:0")
	if err != nil || !address.IP.IsLoopback() {
		t.Fatalf("loopback listener was rejected: %v", err)
	}
}

func TestIntegrationHostRunsNonElevated(t *testing.T) {
	elevated, err := currentProcessElevated()
	if err != nil {
		t.Fatal(err)
	}
	if elevated {
		t.Fatal("test process is elevated")
	}
}

func TestCertificateDeviceResolverRequiresVerifiedPeer(t *testing.T) {
	resolver := certificateDeviceResolver("integration-device")
	request := &http.Request{RemoteAddr: "127.0.0.1:1"}
	if _, err := resolver(request); err == nil {
		t.Fatal("missing verified device certificate was accepted")
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
