//go:build windows

package terminal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

const (
	integrationTimeout       = 15 * time.Second
	agentFailureHelperEnv    = "TERMINUS_CONPTY_AGENT_FAILURE_HELPER"
	agentFailureStatePathEnv = "TERMINUS_CONPTY_AGENT_FAILURE_STATE"
)

func TestWaitForShutdownStopsWaiterBeforeHandleCleanup(t *testing.T) {
	processDone := make(chan processResult, 1)
	abandon := make(chan struct{})
	go func() {
		<-abandon
		processDone <- processResult{}
	}()

	result := waitForShutdown(processDone, abandon, time.Millisecond)
	if result.err == nil || !regexp.MustCompile(`exceeded 1ms`).MatchString(result.err.Error()) {
		t.Fatalf("waitForShutdown error = %v, want bounded-timeout error", result.err)
	}
}

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
	command := "[Console]::WriteLine('TERM_IO_OK'); [Console]::WriteLine(('{0}x{1}' -f $Host.UI.RawUI.WindowSize.Width,$Host.UI.RawUI.WindowSize.Height))\r\n"
	if _, err := session.Write([]byte(command)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	output := readUntil(t, session, []byte("TERM_IO_OK"), []byte("101x31"))
	if !bytes.Contains(output, []byte("TERM_IO_OK")) || !bytes.Contains(output, []byte("101x31")) {
		t.Fatal("synthetic output did not contain the expected I/O and resize markers")
	}
	if _, err := session.Write([]byte("exit 0\r\n")); err != nil {
		t.Fatalf("Write exit: %v", err)
	}
	if err := session.Wait(); err != nil {
		t.Fatalf("Wait: %v", err)
	}
	if err := session.Resize(80, 24); !errors.Is(err, ErrClosed) {
		t.Fatalf("Resize after exit error = %v, want ErrClosed", err)
	}
}

func TestConPTYExitContainsProcessTree(t *testing.T) {
	requireConPTYIntegration(t)
	ctx, cancel := context.WithTimeout(context.Background(), integrationTimeout)
	defer cancel()
	session, err := (LocalAdapter{}).Open(ctx, Config{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer session.Close()
	conpty := session.(*conPTYSession)

	childPID := startSyntheticChild(t, session)
	if _, err := session.Write([]byte("exit 0\r\n")); err != nil {
		t.Fatalf("Write exit: %v", err)
	}
	if err := session.Wait(); err != nil {
		t.Fatalf("Wait: %v", err)
	}
	assertProcessExited(t, conpty.pid)
	assertProcessExited(t, childPID)
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
	conpty := session.(*conPTYSession)

	childPID := startSyntheticChild(t, session)
	cancel()
	if err := session.Wait(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait error = %v, want context.Canceled", err)
	}
	assertProcessExited(t, conpty.pid)
	assertProcessExited(t, childPID)
}

func TestConPTYTimeoutContainsProcessTree(t *testing.T) {
	requireConPTYIntegration(t)
	session, err := (LocalAdapter{}).Open(context.Background(), Config{Timeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	conpty := session.(*conPTYSession)
	childPID := startSyntheticChild(t, session)

	if err := session.Wait(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Wait error = %v, want context.DeadlineExceeded", err)
	}
	assertProcessExited(t, conpty.pid)
	assertProcessExited(t, childPID)
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
	conpty := session.(*conPTYSession)

	childPID := startSyntheticChild(t, session)
	if err := session.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := session.Wait(); !errors.Is(err, ErrClosed) {
		t.Fatalf("Wait error = %v, want ErrClosed", err)
	}
	assertProcessExited(t, conpty.pid)
	assertProcessExited(t, childPID)
}

func TestConPTYAgentFailureContainsProcessTree(t *testing.T) {
	requireConPTYIntegration(t)
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	statePath := filepath.Join(t.TempDir(), "contained-processes.txt")
	command := exec.Command(executable, "-test.run=^TestConPTYAgentFailureHelper$", "-test.v")
	command.Env = append(os.Environ(), agentFailureHelperEnv+"=1", agentFailureStatePathEnv+"="+statePath)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		t.Fatalf("start agent-failure helper: %v", err)
	}

	waitDone := make(chan error, 1)
	go func() {
		waitDone <- command.Wait()
	}()
	helperReaped := false
	defer func() {
		if !helperReaped {
			_ = command.Process.Kill()
			select {
			case <-waitDone:
			case <-time.After(shutdownWaitPeriod):
				t.Error("timed out reaping agent-failure helper")
			}
		}
	}()

	shellPID, childPID, reaped, err := waitForAgentFailureState(statePath, waitDone)
	if err != nil {
		helperReaped = reaped
		t.Fatalf("wait for agent-failure helper: %v", err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatalf("terminate agent-failure helper: %v", err)
	}
	waitErr := <-waitDone
	helperReaped = true
	if waitErr == nil {
		t.Fatal("agent-failure helper exited cleanly after forced termination")
	}
	assertProcessExited(t, shellPID)
	assertProcessExited(t, childPID)
}

func TestConPTYAgentFailureHelper(t *testing.T) {
	if os.Getenv(agentFailureHelperEnv) != "1" {
		t.Skip("helper is launched only by the agent-failure integration test")
	}
	requireConPTYIntegration(t)
	statePath := os.Getenv(agentFailureStatePathEnv)
	if statePath == "" {
		t.Fatal("agent-failure state path is empty")
	}
	session, err := (LocalAdapter{}).Open(context.Background(), Config{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer session.Close()
	conpty := session.(*conPTYSession)
	childPID := startSyntheticChild(t, session)
	state := []byte(fmt.Sprintf("%d %d", conpty.pid, childPID))
	temporaryStatePath := statePath + ".tmp"
	if err := os.WriteFile(temporaryStatePath, state, 0o600); err != nil {
		t.Fatalf("write agent-failure state: %v", err)
	}
	if err := os.Rename(temporaryStatePath, statePath); err != nil {
		t.Fatalf("publish agent-failure state: %v", err)
	}
	select {}
}

func TestConPTYConcurrentCloseAndWaitContainsProcessTree(t *testing.T) {
	requireConPTYIntegration(t)
	session, err := (LocalAdapter{}).Open(context.Background(), Config{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	conpty := session.(*conPTYSession)
	childPID := startSyntheticChild(t, session)

	const callers = 8
	start := make(chan struct{})
	errs := make(chan error, callers*2)
	var group sync.WaitGroup
	for range callers {
		group.Add(2)
		go func() {
			defer group.Done()
			<-start
			if err := session.Wait(); !errors.Is(err, ErrClosed) {
				errs <- fmt.Errorf("concurrent Wait error = %v, want ErrClosed", err)
			}
		}()
		go func() {
			defer group.Done()
			<-start
			if err := session.Close(); err != nil {
				errs <- fmt.Errorf("concurrent Close: %w", err)
			}
		}()
	}
	close(start)
	group.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	assertProcessExited(t, conpty.pid)
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
		t.Fatal("integration must run from a non-elevated process")
	}
}

func waitForAgentFailureState(path string, helperDone <-chan error) (uint32, uint32, bool, error) {
	deadline := time.NewTimer(integrationTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		data, err := os.ReadFile(path)
		if err == nil {
			var shellPID, childPID uint32
			if _, err := fmt.Sscanf(string(data), "%d %d", &shellPID, &childPID); err != nil {
				return 0, 0, false, fmt.Errorf("parse state: %w", err)
			}
			return shellPID, childPID, false, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return 0, 0, false, fmt.Errorf("read state: %w", err)
		}
		select {
		case err := <-helperDone:
			if err == nil {
				return 0, 0, true, errors.New("helper exited cleanly before readiness")
			}
			return 0, 0, true, fmt.Errorf("helper exited before ready: %w", err)
		case <-deadline.C:
			return 0, 0, false, errors.New("timed out waiting for helper")
		case <-ticker.C:
		}
	}
}

func startSyntheticChild(t *testing.T, session Session) uint32 {
	t.Helper()
	command := "$p=Start-Process -FilePath \"$env:SystemRoot\\System32\\ping.exe\" -ArgumentList '-t','127.0.0.1' -PassThru; [Console]::WriteLine((('TERM_CHILD_'+'PID={0}') -f $p.Id))\r\n"
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
