package main

import (
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// This opt-in local verification helper serves web assets only. The explicit
// terminal and intelligence handlers win routing and never cross this proxy.
func stagingWebProxy(raw string) (http.Handler, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || (u.Path != "" && u.Path != "/") || u.Port() == "" {
		return nil, errors.New("invalid local web origin")
	}
	ip := net.ParseIP(u.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return nil, errors.New("web origin must use explicit loopback IP")
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.Transport = &http.Transport{Proxy: nil}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) { http.Error(w, "local web unavailable", 503) }
	proxy.ModifyResponse = func(r *http.Response) error {
		if r.StatusCode >= 300 && r.StatusCode < 400 && r.Header.Get("Location") != "" {
			location, err := url.Parse(r.Header.Get("Location"))
			if err != nil || location.IsAbs() || location.Host != "" {
				return errors.New("redirect rejected")
			}
		}
		return nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/terminal" || r.URL.Path == "/intelligence" || r.Header.Get("Upgrade") != "" {
			http.Error(w, "rejected", 403)
			return
		}
		proxy.ServeHTTP(w, r)
	}), nil
}
