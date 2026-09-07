package main

import (
	"testing"
)

func TestStagingWebProxyRejectsNonLoopbackOrigins(t *testing.T) {
	for _, raw := range []string{"http://localhost:3000", "http://example.invalid:3000", "http://192.0.2.1:3000", "https://127.0.0.1:3000", "http://127.0.0.1:3000/path", "http://user:pass@127.0.0.1:3000", "http://127.0.0.1:3000/?x=y"} {
		if _, err := stagingWebProxy(raw); err == nil {
			t.Fatal("unsafe staging origin")
		}
	}
	if _, err := stagingWebProxy("http://127.0.0.1:3000"); err != nil {
		t.Fatal(err)
	}
}
