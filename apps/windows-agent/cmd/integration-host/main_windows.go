//go:build windows

package main

import (
	"bufio"
	"context"
	"crypto/sha256"
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
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"terminus/windows-agent/internal/endpoint"
	"terminus/windows-agent/internal/protocol"
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
	clientCAPath := flag.String("client-ca", "", "externally supplied CA bundle for private-device client certificates")
	storePath := flag.String("store", defaultStorePath(), "DPAPI CurrentUser credential-store path")
	deviceID := flag.String("device-id", "", "non-secret local integration device identity")
	revokeID := flag.String("revoke-id", "", "non-secret credential ID for revoke mode")
	printPairing := flag.Bool("print-pairing-code", false, "print one pairing code to the attached operator console only")
	flag.Parse()

	store, err := newDPAPIStore(*storePath)
	if err != nil {
		return err
	}
	if elevated, err := currentProcessElevated(); err != nil {
		return fmt.Errorf("check process elevation: %w", err)
	} else if elevated {
		return errors.New("refusing to run integration host from an elevated process")
	}
	switch *mode {
	case "reset":
		return store.Reset(context.Background())
	case "revoke":
		if *revokeID == "" {
			return errors.New("-revoke-id is required in revoke mode")
		}
		if err := requestRevocation(store.path, *revokeID); err != nil {
			return err
		}
		return revokeCredential(context.Background(), store, *revokeID)
	case "serve":
		storeWasExplicit := false
		flag.Visit(func(f *flag.Flag) {
			if f.Name == "store" {
				storeWasExplicit = true
			}
		})
		return serve(*listen, *origin, *serverName, *certPath, *keyPath, *clientCAPath, *deviceID, *printPairing, store, !storeWasExplicit)
	default:
		return fmt.Errorf("unknown mode %q", *mode)
	}
}

func serve(listen, origin, serverName, certPath, keyPath, clientCAPath, deviceID string, printPairing bool, store *dpapiStore, ephemeralStore bool) error {
	if origin == "" || serverName == "" || certPath == "" || keyPath == "" || clientCAPath == "" || deviceID == "" {
		return errors.New("serve requires -origin, -server-name, -cert, -key, -client-ca, and -device-id")
	}
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return fmt.Errorf("load externally supplied TLS certificate: %w", err)
	}
	if err := verifyCertificate(certificate, serverName); err != nil {
		return err
	}
	clientRoots, err := loadClientRoots(clientCAPath)
	if err != nil {
		return err
	}
	endpointInstance, err := endpoint.New(endpoint.Config{
		AllowedOrigin:  origin,
		AgentID:        integrationAgentID,
		Terminal:       terminal.LocalAdapter{},
		Credentials:    store,
		ApprovePairing: boundedLocalApproval,
		ResolveDevice:  certificateDeviceResolver(deviceID),
		Log: func(event endpoint.Event) {
			// Only stable event metadata is emitted. Never log payloads, IDs from
			// requests, credentials, proofs, or terminal bytes.
			fmt.Fprintf(os.Stderr, "event=%s code=%s\n", event.Name, event.Code)
		},
	})
	if err != nil {
		return fmt.Errorf("create endpoint: %w", err)
	}
	resolved, err := validateLoopbackAddress(listen)
	if err != nil {
		return err
	}
	listener, err := net.ListenTCP("tcp", resolved)
	if err != nil {
		return fmt.Errorf("listen on explicit loopback address: %w", err)
	}
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok || address.IP == nil || !address.IP.IsLoopback() || address.IP.IsUnspecified() {
		_ = listener.Close()
		return errors.New("integration host refuses a non-loopback listener")
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}, ServerName: serverName}
	tlsConfig.ClientAuth = tls.RequireAndVerifyClientCert
	tlsConfig.ClientCAs = clientRoots
	serveDone := make(chan error, 1)
	go func() { serveDone <- endpoint.ServeTLS(listener, tlsConfig, healthAndEndpoint(endpointInstance)) }()
	revocationCtx, cancelRevocation := context.WithCancel(context.Background())
	revocationDone := make(chan struct{})
	go func() { defer close(revocationDone); revocationLoop(revocationCtx, endpointInstance, store) }()
	var cleanupOnce sync.Once
	var cleanupErr error
	var serveResult error
	var serveResultReady bool
	cleanup := func() error {
		cleanupOnce.Do(func() {
			cancelRevocation()
			select {
			case <-revocationDone:
			case <-time.After(2 * time.Second):
			}
			closeErr := endpointInstance.Close()
			listenerErr := listener.Close()
			var serveErr error
			if serveResultReady {
				serveErr = serveResult
			} else {
				select {
				case serveErr = <-serveDone:
				case <-time.After(5 * time.Second):
					serveErr = errors.New("loopback listener did not shut down within 5 seconds")
				}
			}
			var errs []error
			if closeErr != nil {
				errs = append(errs, fmt.Errorf("endpoint cleanup: %w", closeErr))
			}
			if listenerErr != nil && !errors.Is(listenerErr, net.ErrClosed) {
				errs = append(errs, fmt.Errorf("loopback listener shutdown: %w", listenerErr))
			}
			if serveErr != nil && !errors.Is(serveErr, net.ErrClosed) {
				errs = append(errs, serveErr)
			}
			if ephemeralStore {
				resetCtx, cancelReset := context.WithTimeout(context.Background(), 5*time.Second)
				if err := store.Reset(resetCtx); err != nil {
					errs = append(errs, err)
				}
				cancelReset()
			}
			cleanupErr = errors.Join(errs...)
		})
		return cleanupErr
	}
	defer func() { _ = cleanup() }()

	if printPairing {
		code, _, issueErr := endpointInstance.IssuePairingCode()
		if issueErr != nil {
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
		serveResult = err
		serveResultReady = true
		if err != nil {
			if cleanupErr := cleanup(); cleanupErr != nil {
				return fmt.Errorf("serve failed: %w; cleanup: %v", err, cleanupErr)
			}
			return err
		}
	}
	return cleanup()
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

func validateLoopbackAddress(value string) (*net.TCPAddr, error) {
	address, err := net.ResolveTCPAddr("tcp", value)
	if err != nil {
		return nil, fmt.Errorf("resolve explicit loopback address: %w", err)
	}
	if address.IP == nil || address.IP.IsUnspecified() || !address.IP.IsLoopback() {
		return nil, errors.New("integration host requires an explicit loopback IP listener")
	}
	return address, nil
}

func certificateDeviceResolver(fallback string) endpoint.DeviceResolver {
	return func(r *http.Request) (string, error) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || !net.ParseIP(host).IsLoopback() {
			return "", errors.New("peer is not loopback")
		}
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 || len(r.TLS.VerifiedChains) == 0 {
			return "", errors.New("verified private-device certificate is required")
		}
		leaf := r.TLS.PeerCertificates[0]
		if fallback == "" {
			return "", errors.New("private-device identity is empty")
		}
		fingerprint := sha256.Sum256(leaf.Raw)
		return fallback + ":" + fmt.Sprintf("%x", fingerprint[:]), nil
	}
}

func boundedLocalApproval(ctx context.Context, approval endpoint.PairingApproval) bool {
	if ctx == nil {
		return false
	}
	if approval.Origin == "" || approval.ClientInstanceID == "" || approval.DeviceIdentity == "" {
		return false
	}
	result := make(chan bool, 1)
	request := approvalRequest{ctx: ctx, approval: approval, result: result}
	select {
	case approvalConsoleInstance.requests <- request:
	case <-ctx.Done():
		approvalConsoleInstance.abort()
		return false
	}
	select {
	case approved := <-result:
		return approved
	case <-ctx.Done():
		return false
	}
}

type approvalRequest struct {
	ctx      context.Context
	approval endpoint.PairingApproval
	result   chan bool
}

type approvalConsole struct {
	requests  chan approvalRequest
	abortOnce sync.Once
}

func (c *approvalConsole) abort() {
	c.abortOnce.Do(func() { _ = os.Stdin.Close() })
}

var approvalConsoleInstance = newApprovalConsole()

func newApprovalConsole() *approvalConsole {
	console := &approvalConsole{requests: make(chan approvalRequest)}
	go console.run()
	return console
}

func (c *approvalConsole) run() {
	reader := bufio.NewReader(os.Stdin)
	for request := range c.requests {
		if request.ctx.Err() != nil {
			continue
		}
		fmt.Fprintf(os.Stderr, "pairing request origin=%s client=%s device=%s; approve? [y/N] ", request.approval.Origin, request.approval.ClientInstanceID, request.approval.DeviceIdentity)
		line, err := reader.ReadString('\n')
		approved := err == nil && strings.EqualFold(strings.TrimSpace(line), "y")
		if request.ctx.Err() == nil {
			request.result <- approved
		}
	}
}

func requestRevocation(storePath, credentialID string) error {
	if storePath == "" || credentialID == "" {
		return errors.New("store path and credential ID are required")
	}
	if !protocol.ValidUUID(credentialID) {
		return errors.New("credential ID must be a lowercase UUIDv4")
	}
	directory := filepath.Join(filepath.Dir(storePath), ".terminus-revocations")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return fmt.Errorf("create revocation request directory: %w", err)
	}
	marker := filepath.Join(directory, credentialID+".request")
	file, err := os.OpenFile(marker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("create revocation request: %w", err)
	}
	if file != nil {
		_ = file.Close()
	}
	return nil
}

func revocationLoop(ctx context.Context, ep *endpoint.Endpoint, store *dpapiStore) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			directory := filepath.Join(filepath.Dir(store.path), ".terminus-revocations")
			entries, err := os.ReadDir(directory)
			if err != nil {
				continue
			}
			for _, entry := range entries {
				name := entry.Name()
				if entry.IsDir() || !strings.HasSuffix(name, ".request") {
					continue
				}
				credentialID := strings.TrimSuffix(name, ".request")
				if !protocol.ValidUUID(credentialID) {
					continue
				}
				marker := filepath.Join(directory, name)
				if err := ep.RevokeCredential(ctx, credentialID); err == nil {
					_ = os.Remove(marker)
				}
			}
		}
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

func loadClientRoots(path string) (*x509.CertPool, error) {
	pemBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read private-device CA bundle: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pemBytes) {
		return nil, errors.New("private-device CA bundle contains no certificates")
	}
	return pool, nil
}

func revokeCredential(ctx context.Context, store *dpapiStore, credentialID string) error {
	ep, err := endpoint.New(endpoint.Config{
		AllowedOrigin:  "https://integration.invalid",
		AgentID:        integrationAgentID,
		Terminal:       terminal.LocalAdapter{},
		Credentials:    store,
		ApprovePairing: func(context.Context, endpoint.PairingApproval) bool { return false },
		ResolveDevice: func(*http.Request) (string, error) {
			return "", errors.New("device resolution unavailable in revoke mode")
		},
	})
	if err != nil {
		return err
	}
	defer ep.Close()
	return ep.RevokeCredential(ctx, credentialID)
}

func currentProcessElevated() (bool, error) {
	var token windows.Token
	if err := windows.OpenProcessToken(windows.CurrentProcess(), windows.TOKEN_QUERY, &token); err != nil {
		return false, err
	}
	defer token.Close()
	return token.IsElevated(), nil
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
