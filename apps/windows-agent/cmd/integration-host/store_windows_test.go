//go:build windows

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"terminus/windows-agent/internal/endpoint"
)

func TestDPAPIStoreIsCurrentUserProtectedAndResettable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.dpapi")
	store, err := newDPAPIStore(path)
	if err != nil {
		t.Fatal(err)
	}
	credential := endpoint.Credential{ID: "70000000-0000-4000-8000-000000000001", ExpiresAt: time.Now().Add(time.Hour)}
	for i := range credential.Secret {
		credential.Secret[i] = byte(i + 1)
	}
	if err := store.Put(context.Background(), credential); err != nil {
		t.Fatal(err)
	}
	ciphertext, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(ciphertext) == 0 {
		t.Fatal("protected store is empty")
	}
	if string(ciphertext) == string(credential.Secret[:]) {
		t.Fatal("credential secret was written as plaintext")
	}
	got, err := store.Get(context.Background(), credential.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != credential.ID || got.Secret != credential.Secret {
		t.Fatal("protected credential round trip mismatch")
	}
	if err := store.Delete(context.Background(), credential.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), credential.ID); err == nil {
		t.Fatal("deleted credential remained readable")
	}
	if err := store.Reset(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("protected store still exists after reset: %v", err)
	}
}
