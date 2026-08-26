//go:build windows

package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"terminus/windows-agent/internal/endpoint"
)

// dpapiStore encrypts the complete credential map with Windows DPAPI's
// CurrentUser scope. It is therefore bound to the non-elevated Windows
// identity running this integration host; no key or credential is persisted in
// plaintext. The file is temporary by default and is deleted by the host on
// clean shutdown.
type dpapiStore struct {
	mu   sync.Mutex
	path string
}

type processStoreLock struct {
	file *os.File
	over windows.Overlapped
}

type storedCredential struct {
	ID        string    `json:"id"`
	Secret    []byte    `json:"secret"`
	ExpiresAt time.Time `json:"expiresAt"`
}

var (
	crypt32             = windows.NewLazySystemDLL("crypt32.dll")
	procCryptProtect    = crypt32.NewProc("CryptProtectData")
	procCryptUnprotect  = crypt32.NewProc("CryptUnprotectData")
	kernel32Integration = windows.NewLazySystemDLL("kernel32.dll")
	procLocalFree       = kernel32Integration.NewProc("LocalFree")
)

const cryptProtectUIForbidden = 0x1

type dataBlob struct {
	cbData uint32
	pbData *byte
}

func newDPAPIStore(path string) (*dpapiStore, error) {
	if path == "" {
		return nil, errors.New("credential store path is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("credential store path: %w", err)
	}
	return &dpapiStore{path: absolute}, nil
}

func (s *dpapiStore) Put(ctx context.Context, credential endpoint.Credential) error {
	if err := contextErr(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, err := s.lockProcess(ctx)
	if err != nil {
		return err
	}
	defer lock.Unlock()
	records, err := s.readLocked()
	if err != nil {
		return err
	}
	secret := make([]byte, len(credential.Secret))
	copy(secret, credential.Secret[:])
	records[credential.ID] = storedCredential{ID: credential.ID, Secret: secret, ExpiresAt: credential.ExpiresAt.UTC()}
	return s.writeLocked(records)
}

func (s *dpapiStore) Get(ctx context.Context, id string) (endpoint.Credential, error) {
	if err := contextErr(ctx); err != nil {
		return endpoint.Credential{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, err := s.lockProcess(ctx)
	if err != nil {
		return endpoint.Credential{}, err
	}
	defer lock.Unlock()
	records, err := s.readLocked()
	if err != nil {
		return endpoint.Credential{}, err
	}
	record, ok := records[id]
	if !ok || len(record.Secret) != 32 {
		return endpoint.Credential{}, errors.New("credential not found")
	}
	var secret [32]byte
	copy(secret[:], record.Secret)
	return endpoint.Credential{ID: record.ID, Secret: secret, ExpiresAt: record.ExpiresAt}, nil
}

func (s *dpapiStore) Delete(ctx context.Context, id string) error {
	if err := contextErr(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, err := s.lockProcess(ctx)
	if err != nil {
		return err
	}
	defer lock.Unlock()
	records, err := s.readLocked()
	if err != nil {
		return err
	}
	delete(records, id)
	return s.writeLocked(records)
}

func (s *dpapiStore) IDs(ctx context.Context) ([]string, error) {
	if err := contextErr(ctx); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, err := s.lockProcess(ctx)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()
	records, err := s.readLocked()
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(records))
	for id := range records {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}

func (s *dpapiStore) Reset(ctx context.Context) error {
	if err := contextErr(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, err := s.lockProcess(ctx)
	if err != nil {
		return err
	}
	defer lock.Unlock()
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove protected credential store: %w", err)
	}
	return nil
}

func (s *dpapiStore) lockProcess(ctx context.Context) (*processStoreLock, error) {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return nil, fmt.Errorf("create credential store lock directory: %w", err)
	}
	file, err := os.OpenFile(s.path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open credential store lock: %w", err)
	}
	lock := &processStoreLock{file: file}
	for {
		err = windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &lock.over)
		if err == nil {
			return lock, nil
		}
		if !errors.Is(err, windows.ERROR_LOCK_VIOLATION) && !errors.Is(err, windows.ERROR_IO_PENDING) {
			_ = file.Close()
			return nil, fmt.Errorf("lock credential store: %w", err)
		}
		select {
		case <-ctx.Done():
			_ = file.Close()
			return nil, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func (l *processStoreLock) Unlock() {
	if l == nil || l.file == nil {
		return
	}
	_ = windows.UnlockFileEx(windows.Handle(l.file.Fd()), 0, 1, 0, &l.over)
	_ = l.file.Close()
}

func (s *dpapiStore) readLocked() (map[string]storedCredential, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return make(map[string]storedCredential), nil
	}
	if err != nil {
		return nil, fmt.Errorf("read protected credential store: %w", err)
	}
	plain, err := unprotect(data)
	if err != nil {
		return nil, fmt.Errorf("unprotect credential store: %w", err)
	}
	var records map[string]storedCredential
	if err := json.Unmarshal(plain, &records); err != nil {
		return nil, fmt.Errorf("decode protected credential store: %w", err)
	}
	if records == nil {
		records = make(map[string]storedCredential)
	}
	return records, nil
}

func (s *dpapiStore) writeLocked(records map[string]storedCredential) error {
	plain, err := json.Marshal(records)
	if err != nil {
		return fmt.Errorf("encode credential store: %w", err)
	}
	protected, err := protect(plain)
	if err != nil {
		return fmt.Errorf("protect credential store: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return fmt.Errorf("create credential store directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".terminus-credential-*")
	if err != nil {
		return fmt.Errorf("create protected store temporary file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("restrict protected store temporary file: %w", err)
	}
	if _, err := tmp.Write(protected); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write protected store: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close protected store: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("replace protected store: %w", err)
	}
	return nil
}

func contextErr(ctx context.Context) error {
	if ctx == nil {
		return errors.New("nil context")
	}
	return ctx.Err()
}

func protect(plain []byte) ([]byte, error) {
	return cryptTransform(procCryptProtect, plain)
}

func unprotect(ciphertext []byte) ([]byte, error) {
	return cryptTransform(procCryptUnprotect, ciphertext)
}

func cryptTransform(proc *windows.LazyProc, input []byte) ([]byte, error) {
	if len(input) == 0 {
		input = []byte{0}
	}
	inputBlob := dataBlob{cbData: uint32(len(input)), pbData: &input[0]}
	var outputBlob dataBlob
	// DPAPI's optional entropy is a public application binding, not a secret.
	// A hash prevents accidental cross-application unprotect attempts.
	entropyBytes := sha256.Sum256([]byte("terminus.windows-agent.integration.dpapi.v1"))
	entropyBlob := dataBlob{cbData: uint32(len(entropyBytes)), pbData: &entropyBytes[0]}
	flags := uintptr(cryptProtectUIForbidden)
	ret, _, callErr := proc.Call(uintptr(unsafe.Pointer(&inputBlob)), 0, uintptr(unsafe.Pointer(&entropyBlob)), 0, 0, flags, uintptr(unsafe.Pointer(&outputBlob)))
	if ret == 0 {
		if callErr != windows.ERROR_SUCCESS {
			return nil, callErr
		}
		return nil, errors.New("Windows protected-data operation failed")
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(outputBlob.pbData)))
	if outputBlob.pbData == nil || outputBlob.cbData == 0 {
		return nil, errors.New("Windows protected-data operation returned empty data")
	}
	result := unsafe.Slice(outputBlob.pbData, outputBlob.cbData)
	return append([]byte(nil), result...), nil
}
