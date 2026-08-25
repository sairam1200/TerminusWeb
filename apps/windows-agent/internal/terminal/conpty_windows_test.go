//go:build windows

package terminal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

const integrationTimeout = 15 * time.Second

func TestConPTYInputOutputResizeAndExit(t *testing.T) {
	requireConPTYIntegration(t)
	ctx, cancel := context.WithTimeout(context.Background(), integrationTimeout)
	defer cancel()

	session, err := (LocalAdapter{}).Open(ctx, Config{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer session.Close()

	if err := session.Resize(101, 31); err != nil {
		t.Fatalf("Resize: %v", err)
	}
	command := "[Console]::WriteLine('TERM_IO_OK'); [Console]::WriteLine(('{0}x{1}' -f $Host.UI.RawUI.WindowSize.Width,$Host.UI.RawUI.WindowSize.Height)); exit 0\r\n"
	if _, err := session.Write([]byte(command)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	output := readUntil(t, session, []byte("TERM_IO_OK"), []byte("101x31"))
	if !bytes.Contains(output, []byte("TERM_IO_OK")) || !bytes.Contains(output, []byte("101x31")) {
		t.Fatal("synthetic output did not contain the expected I/O and resize markers")
	}
	if err := session.Wait(); err != nil {
		t.Fatalf("Wait: %v", err)
	}
	if err := session.Resize(80, 24); !errors.Is(err, ErrClosed) {
		t.Fatalf("Resize after exit error = %v, want ErrClosed", err)
	}
}

func TestConPTYCancellationContainsProcessTree(t *testing.T) {
	requireConPTYIntegration(t)
	ctx, cancel := context.WithCancel(context.Background())
	session, err := (LocalAdapter{}).Open(ctx, Config{})
	if err != nil {
		cancel()
		t.Fatalf("Open: %v", err)
	}
	defer session.Close()

	childPID := startSyntheticChild(t, session)
	cancel()
	if err := session.Wait(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait error = %v, want context.Canceled", err)
	}
	assertProcessExited(t, childPID)
}

func TestConPTYTimeoutCleansUp(t *testing.T) {
	requireConPTYIntegration(t)
	session, err := (LocalAdapter{}).Open(context.Background(), Config{Timeout: 500 * time.Millisecond})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	conpty := session.(*conPTYSession)
	pid := conpty.pid

	if err := session.Wait(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Wait error = %v, want context.DeadlineExceeded", err)
	}
	assertProcessExited(t, pid)
	if err := session.Close(); err != nil {
		t.Fatalf("Close after timeout: %v", err)
	}
}

func TestConPTYCloseContainsProcessTree(t *testing.T) {
	requireConPTYIntegration(t)
	ctx, cancel := context.WithTimeout(context.Background(), integrationTimeout)
	defer cancel()
	session, err := (LocalAdapter{}).Open(ctx, Config{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	childPID := startSyntheticChild(t, session)
	if err := session.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := session.Wait(); !errors.Is(err, ErrClosed) {
		t.Fatalf("Wait error = %v, want ErrClosed", err)
	}
	assertProcessExited(t, childPID)
}

func TestConPTYResizeRejectsInvalidDimensions(t *testing.T) {
	requireConPTYIntegration(t)
	ctx, cancel := context.WithTimeout(context.Background(), integrationTimeout)
	defer cancel()
	session, err := (LocalAdapter{}).Open(ctx, Config{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer session.Close()

	if err := session.Resize(0, 24); err == nil {
		t.Fatal("Resize accepted zero columns")
	}
	if err := session.Resize(80, 0); err == nil {
		t.Fatal("Resize accepted zero rows")
	}
}

func requireConPTYIntegration(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping Windows ConPTY integration in short mode")
	}
	elevated, err := currentProcessElevated()
	if err != nil {
		t.Fatalf("currentProcessElevated: %v", err)
	}
	if elevated {
		t.Skip("integration must run from a non-elevated process")
	}
}

func startSyntheticChild(t *testing.T, session Session) uint32 {
	t.Helper()
	command := "$p=Start-Process -FilePath \"$env:SystemRoot\\System32\\ping.exe\" -ArgumentList '-t','127.0.0.1' -PassThru; [Console]::WriteLine(('TERM_CHILD_PID={0}' -f $p.Id))\r\n"
	if _, err := session.Write([]byte(command)); err != nil {
		t.Fatalf("Write child command: %v", err)
	}
	output := readUntil(t, session, []byte("TERM_CHILD_PID="))
	match := regexp.MustCompile(`TERM_CHILD_PID=(\d+)`).FindSubmatch(output)
	if len(match) != 2 {
		t.Fatal("synthetic output did not contain a child process identifier")
	}
	pid, err := strconv.ParseUint(string(match[1]), 10, 32)
	if err != nil {
		t.Fatalf("parse child process identifier: %v", err)
	}
	return uint32(pid)
}

func readUntil(t *testing.T, session Session, markers ...[]byte) []byte {
	t.Helper()
	type readResult struct {
		data []byte
		err  error
	}
	result := make(chan readResult, 1)
	go func() {
		var collected []byte
		buffer := make([]byte, 4096)
		for len(collected) < 1<<20 {
			n, err := session.Read(buffer)
			if n > 0 {
				collected = append(collected, buffer[:n]...)
				foundAll := true
				for _, marker := range markers {
					foundAll = foundAll && bytes.Contains(collected, marker)
				}
				if foundAll {
					result <- readResult{data: collected}
					return
				}
			}
			if err != nil {
				result <- readResult{data: collected, err: err}
				return
			}
		}
		result <- readResult{err: errors.New("synthetic terminal output exceeded 1 MiB")}
	}()

	select {
	case got := <-result:
		if got.err != nil {
			t.Fatalf("Read synthetic output: %v", got.err)
		}
		return got.data
	case <-time.After(integrationTimeout):
		t.Fatal("timed out waiting for synthetic terminal markers")
		return nil
	}
}

func assertProcessExited(t *testing.T, pid uint32) {
	t.Helper()
	process, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return
	}
	if err != nil {
		t.Fatalf("OpenProcess(%d): %v", pid, err)
	}
	defer windows.CloseHandle(process)

	status, err := windows.WaitForSingleObject(process, 5_000)
	if err != nil {
		t.Fatalf("WaitForSingleObject(%d): %v", pid, err)
	}
	if status != windows.WAIT_OBJECT_0 {
		t.Fatal(fmt.Sprintf("contained process %d remained alive (wait status %d)", pid, status))
	}
}
