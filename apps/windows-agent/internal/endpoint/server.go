package endpoint

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"
)

// ServeTLS serves HTTPS/WSS on a caller-owned loopback listener. Private
// publication is deliberately outside this process and must be provided by an
// approved Tailscale serving layer; this function rejects wildcard, LAN, and
// tailnet interface binds.
func ServeTLS(listener net.Listener, tlsConfig *tls.Config, handler http.Handler) error {
	if listener == nil || tlsConfig == nil || handler == nil {
		return errors.New("listener, TLS configuration, and handler are required")
	}
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok || address.IP == nil || address.IP.IsUnspecified() || !address.IP.IsLoopback() {
		return errors.New("listener must be explicitly bound to a loopback IP address")
	}
	config := tlsConfig.Clone()
	if len(config.Certificates) == 0 && config.GetCertificate == nil {
		return errors.New("TLS certificate is required")
	}
	config.MinVersion = tls.VersionTLS13
	server := &http.Server{Handler: handler, ReadHeaderTimeout: helloLimit, TLSConfig: config}
	err := server.Serve(tls.NewListener(listener, config))
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
