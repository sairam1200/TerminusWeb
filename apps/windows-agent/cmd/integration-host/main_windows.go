//go:build windows

package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"terminus/windows-agent/internal/endpoint"
	"terminus/windows-agent/internal/terminal"
)

const integrationAgentID = "60000000-0000-4000-8000-000000000003"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "integration host unavailable")
		os.Exit(1)
	}
}

func run() error {
	mode := flag.String("mode", "serve", "serve, reset, or revoke")
	listen := flag.String("listen", "127.0.0.1:0", "explicit loopback listen address")
	origin := flag.String("origin", "", "one exact HTTPS browser Origin")
	serverName := flag.String("server-name", "", "certificate DNS name or IP to verify")
	certPath := flag.String("cert", "", "externally supplied already-trusted certificate chain")
	keyPath := flag.String("key", "", "externally supplied private key for the certificate")
	storePath := flag.String("store", defaultStorePath(), "DPAPI CurrentUser credential-store path")
	deviceID := flag.String("device-id", "", "non-secret local integration device identity")
	revokeID := flag.String("revoke-id", "", "non-secret credential ID for revoke mode")
	printPairing := flag.Bool("print-pairing-code", false, "print one pairing code to the attached operator console only")
	flag.Parse()

	store, err := newDPAPIStore(*storePath)
	if err != nil {
		return err
	}
	switch *mode {
	case "reset":
		return store.Reset(context.Background())
	case "revoke":
		if *revokeID == "" {
			return errors.New("-revoke-id is required in revoke mode")
		}
		return store.Delete(context.Background(), *revokeID)
	case "serve":
		storeWasExplicit := false
		flag.Visit(func(f *flag.Flag) {
			if f.Name == "store" {
				storeWasExplicit = true
			}
		})
		return serve(*listen, *origin, *serverName, *certPath, *keyPath, *deviceID, *printPairing, store, !storeWasExplicit)
	default:
		return fmt.Errorf("unknown mode %q", *mode)
	}
}

func serve(listen, origin, serverName, certPath, keyPath, deviceID string, printPairing bool, store *dpapiStore, ephemeralStore bool) error {
	if origin == "" || serverName == "" || certPath == "" || keyPath == "" || deviceID == "" {
		return errors.New("serve requires -origin, -server-name, -cert, -key, and -device-id")
	}
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return fmt.Errorf("load externally supplied TLS certificate: %w", err)
	}
	if err := verifyCertificate(certificate, serverName); err != nil {
		return err
	}
	endpointInstance, err := endpoint.New(endpoint.Config{
		AllowedOrigin:  origin,
		AgentID:        integrationAgentID,
		Terminal:       terminal.LocalAdapter{},
		Credentials:    store,
		ApprovePairing: boundedLocalApproval,
		ResolveDevice:  loopbackDeviceResolver(deviceID),
		Log: func(event endpoint.Event) {
			// Only stable event metadata is emitted. Never log payloads, IDs from
			// requests, credentials, proofs, or terminal bytes.
			fmt.Fprintf(os.Stderr, "event=%s code=%s\n", event.Name, event.Code)
		},
	})
	if err != nil {
		return fmt.Errorf("create endpoint: %w", err)
	}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return fmt.Errorf("listen on explicit loopback address: %w", err)
	}
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok || address.IP == nil || !address.IP.IsLoopback() || address.IP.IsUnspecified() {
		_ = listener.Close()
		return errors.New("integration host refuses a non-loopback listener")
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}, ServerName: serverName}
	serveDone := make(chan error, 1)
	go func() { serveDone <- endpoint.ServeTLS(listener, tlsConfig, healthAndEndpoint(endpointInstance)) }()

	if printPairing {
		code, _, issueErr := endpointInstance.IssuePairingCode()
		if issueErr != nil {
			_ = endpointInstance.Close()
			_ = listener.Close()
			return fmt.Errorf("issue local pairing code: %w", issueErr)
		}
		// Explicit opt-in operator output only; it is not logged or persisted.
		fmt.Fprintln(os.Stdout, code)
	}
	fmt.Fprintf(os.Stdout, "listening=127.0.0.1:%d\n", address.Port)
	fmt.Fprintln(os.Stdout, "health=/healthz")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case err := <-serveDone:
		if err != nil {
			return err
		}
	}
	closeErr := endpointInstance.Close()
	listenerErr := listener.Close()
	if closeErr != nil {
		return fmt.Errorf("endpoint cleanup: %w", closeErr)
	}
	if listenerErr != nil && !errors.Is(listenerErr, net.ErrClosed) {
		return fmt.Errorf("loopback listener shutdown: %w", listenerErr)
	}
	select {
	case err := <-serveDone:
		if err != nil && !errors.Is(err, net.ErrClosed) {
			return err
		}
	case <-time.After(5 * time.Second):
		return errors.New("loopback listener did not shut down within 5 seconds")
	}
	if ephemeralStore {
		if err := store.Reset(context.Background()); err != nil {
			return err
		}
	}
	return nil
}

func healthAndEndpoint(ep *endpoint.Endpoint) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, "ok\n")
	})
	mux.Handle("/terminal", ep)
	return mux
}

func loopbackDeviceResolver(deviceID string) endpoint.DeviceResolver {
	return func(r *http.Request) (string, error) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || !net.ParseIP(host).IsLoopback() {
			return "", errors.New("peer is not loopback")
		}
		return deviceID, nil
	}
}

func boundedLocalApproval(ctx context.Context, _ endpoint.PairingApproval) bool {
	if ctx == nil {
		return false
	}
	result := make(chan bool, 1)
	go func() {
		var answer string
		fmt.Fprint(os.Stderr, "pairing request received; approve? [y/N] ")
		_, err := fmt.Fscanln(os.Stdin, &answer)
		result <- err == nil && strings.EqualFold(answer, "y")
	}()
	select {
	case approved := <-result:
		return approved
	case <-ctx.Done():
		return false
	}
}

func verifyCertificate(certificate tls.Certificate, serverName string) error {
	if len(certificate.Certificate) == 0 {
		return errors.New("certificate chain is empty")
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return fmt.Errorf("parse supplied certificate: %w", err)
	}
	if err := leaf.VerifyHostname(serverName); err != nil {
		return fmt.Errorf("supplied certificate does not cover -server-name: %w", err)
	}
	if !containsServerAuth(leaf.ExtKeyUsage) {
		return errors.New("supplied certificate lacks server-auth usage")
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		return fmt.Errorf("load Windows trusted certificate roots: %w", err)
	}
	intermediates := x509.NewCertPool()
	for _, encoded := range certificate.Certificate[1:] {
		intermediate, parseErr := x509.ParseCertificate(encoded)
		if parseErr != nil {
			return fmt.Errorf("parse supplied certificate chain: %w", parseErr)
		}
		intermediates.AddCert(intermediate)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates, DNSName: serverName, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}); err != nil {
		return fmt.Errorf("supplied certificate is not trusted by the current Windows user: %w", err)
	}
	return nil
}

func containsServerAuth(usages []x509.ExtKeyUsage) bool {
	if len(usages) == 0 {
		return true
	}
	for _, usage := range usages {
		if usage == x509.ExtKeyUsageServerAuth || usage == x509.ExtKeyUsageAny {
			return true
		}
	}
	return false
}

func defaultStorePath() string {
	base := os.TempDir()
	return filepath.Join(base, fmt.Sprintf("terminus-windows-agent-integration-%d.dpapi", os.Getpid()))
}
