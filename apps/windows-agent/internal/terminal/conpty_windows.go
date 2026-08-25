//go:build windows

package terminal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

const forcedExitCode uint32 = 0x5445524d // "TERM"; local lifecycle only.

var (
	kernel32                = windows.NewLazySystemDLL("kernel32.dll")
	procCreatePseudoConsole = kernel32.NewProc("CreatePseudoConsole")
	procResizePseudoConsole = kernel32.NewProc("ResizePseudoConsole")
	procClosePseudoConsole  = kernel32.NewProc("ClosePseudoConsole")
)

type stopRequest struct {
	cause error
}

type processResult struct {
	exitCode uint32
	err      error
}

type conPTYSession struct {
	input   *os.File
	output  *os.File
	pid     uint32
	process windows.Handle
	job     windows.Handle
	hpc     windows.Handle

	stateMu sync.RWMutex
	writeMu sync.Mutex
	closed  bool

	stopOnce sync.Once
	stop     chan stopRequest
	done     chan struct{}

	resultMu   sync.Mutex
	result     error
	cleanupErr error
}

func openLocalSession(parent context.Context, cfg Config) (_ Session, retErr error) {
	elevated, err := currentProcessElevated()
	if err != nil {
		return nil, fmt.Errorf("check process elevation: %w", err)
	}
	if elevated {
		return nil, ErrElevated
	}

	ctx := parent
	cancel := func() {}
	if cfg.Timeout > 0 {
		ctx, cancel = context.WithTimeout(parent, cfg.Timeout)
	} else {
		ctx, cancel = context.WithCancel(parent)
	}

	s := &conPTYSession{
		stop: make(chan stopRequest, 1),
		done: make(chan struct{}),
	}
	succeeded := false
	defer func() {
		if !succeeded {
			cancel()
			retErr = errors.Join(retErr, s.releaseHandles())
		}
	}()

	var pseudoInput, hostInput windows.Handle
	if err := windows.CreatePipe(&pseudoInput, &hostInput, nil, 0); err != nil {
		return nil, fmt.Errorf("create ConPTY input pipe: %w", err)
	}
	defer closeHandle(&pseudoInput)
	defer closeHandle(&hostInput)

	var hostOutput, pseudoOutput windows.Handle
	if err := windows.CreatePipe(&hostOutput, &pseudoOutput, nil, 0); err != nil {
		return nil, fmt.Errorf("create ConPTY output pipe: %w", err)
	}
	defer closeHandle(&hostOutput)
	defer closeHandle(&pseudoOutput)

	if err := createPseudoConsole(cfg.Columns, cfg.Rows, pseudoInput, pseudoOutput, &s.hpc); err != nil {
		return nil, fmt.Errorf("create pseudoconsole: %w", err)
	}

	s.job, err = newKillOnCloseJob()
	if err != nil {
		return nil, err
	}

	attributes, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, fmt.Errorf("create process attribute list: %w", err)
	}
	defer attributes.Delete()
	if err := attributes.Update(
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		unsafe.Pointer(s.hpc),
		unsafe.Sizeof(s.hpc),
	); err != nil {
		return nil, fmt.Errorf("attach pseudoconsole process attribute: %w", err)
	}

	powerShellPath, err := inboxPowerShellPath()
	if err != nil {
		return nil, err
	}
	application, err := windows.UTF16PtrFromString(powerShellPath)
	if err != nil {
		return nil, fmt.Errorf("encode PowerShell path: %w", err)
	}
	commandLine, err := windows.UTF16FromString(windows.ComposeCommandLine([]string{
		powerShellPath,
		"-NoLogo",
		"-NoProfile",
		"-NoExit",
		"-Command",
		"-",
	}))
	if err != nil {
		return nil, fmt.Errorf("encode PowerShell command line: %w", err)
	}

	startup := windows.StartupInfoEx{}
	startup.Cb = uint32(unsafe.Sizeof(startup))
	startup.ProcThreadAttributeList = attributes.List()
	processInfo := windows.ProcessInformation{}
	creationFlags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_SUSPENDED | windows.CREATE_UNICODE_ENVIRONMENT)
	if err := windows.CreateProcess(
		application,
		&commandLine[0],
		nil,
		nil,
		false,
		creationFlags,
		nil,
		nil,
		&startup.StartupInfo,
		&processInfo,
	); err != nil {
		return nil, fmt.Errorf("create non-elevated PowerShell process: %w", err)
	}
	s.process = processInfo.Process
	s.pid = processInfo.ProcessId
	thread := processInfo.Thread
	defer closeHandle(&thread)

	if err := windows.AssignProcessToJobObject(s.job, s.process); err != nil {
		_ = windows.TerminateProcess(s.process, forcedExitCode)
		return nil, fmt.Errorf("assign PowerShell to containment job: %w", err)
	}
	if _, err := windows.ResumeThread(thread); err != nil {
		_ = windows.TerminateJobObject(s.job, forcedExitCode)
		return nil, fmt.Errorf("resume contained PowerShell process: %w", err)
	}

	// The pseudoconsole owns its references after process creation. Releasing
	// these host references allows both channels to report closure correctly.
	closeHandle(&pseudoInput)
	closeHandle(&pseudoOutput)

	s.input = os.NewFile(uintptr(hostInput), "conpty-input")
	hostInput = 0
	s.output = os.NewFile(uintptr(hostOutput), "conpty-output")
	hostOutput = 0

	succeeded = true
	go s.supervise(ctx, cancel)
	return s, nil
}

func (s *conPTYSession) Read(p []byte) (int, error) {
	s.stateMu.RLock()
	if s.closed {
		s.stateMu.RUnlock()
		return 0, ErrClosed
	}
	output := s.output
	s.stateMu.RUnlock()
	return output.Read(p)
}

func (s *conPTYSession) Write(p []byte) (int, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	s.stateMu.RLock()
	if s.closed {
		s.stateMu.RUnlock()
		return 0, ErrClosed
	}
	input := s.input
	s.stateMu.RUnlock()
	return input.Write(p)
}

func (s *conPTYSession) Resize(columns, rows uint16) error {
	if columns == 0 || rows == 0 || columns > maxDimension || rows > maxDimension {
		return fmt.Errorf("resize terminal: dimensions must be between 1 and %d", maxDimension)
	}

	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	if s.closed {
		return ErrClosed
	}
	if err := resizePseudoConsole(s.hpc, columns, rows); err != nil {
		return fmt.Errorf("resize terminal: %w", err)
	}
	return nil
}

func (s *conPTYSession) Wait() error {
	<-s.done
	s.resultMu.Lock()
	defer s.resultMu.Unlock()
	return s.result
}

func (s *conPTYSession) Close() error {
	s.requestStop(ErrClosed)
	<-s.done
	s.resultMu.Lock()
	defer s.resultMu.Unlock()
	return s.cleanupErr
}

func (s *conPTYSession) requestStop(cause error) {
	s.stopOnce.Do(func() {
		s.stop <- stopRequest{cause: cause}
	})
}

func (s *conPTYSession) supervise(ctx context.Context, cancel context.CancelFunc) {
	defer cancel()
	processDone := make(chan processResult, 1)
	go func() {
		processDone <- waitForProcess(s.process)
	}()

	var result processResult
	var cause error
	var terminateErr error
	select {
	case result = <-processDone:
	case request := <-s.stop:
		cause = request.cause
		terminateErr = s.terminateJob()
		result = <-processDone
	case <-ctx.Done():
		cause = ctx.Err()
		terminateErr = s.terminateJob()
		result = <-processDone
	}

	cleanupErr := s.releaseHandles()
	waitErr := result.err
	if waitErr == nil && cause == nil && result.exitCode != 0 {
		waitErr = fmt.Errorf("PowerShell exited with code %d", result.exitCode)
	}

	s.resultMu.Lock()
	s.cleanupErr = errors.Join(terminateErr, cleanupErr)
	s.result = errors.Join(cause, waitErr, s.cleanupErr)
	s.resultMu.Unlock()
	close(s.done)
}

func (s *conPTYSession) terminateJob() error {
	s.stateMu.RLock()
	defer s.stateMu.RUnlock()
	if s.closed || s.job == 0 {
		return nil
	}
	if err := windows.TerminateJobObject(s.job, forcedExitCode); err != nil {
		return fmt.Errorf("terminate containment job: %w", err)
	}
	return nil
}

func (s *conPTYSession) releaseHandles() error {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true

	var errs []error
	// Closing the host pipes before ClosePseudoConsole prevents the documented
	// synchronous-output deadlock on Windows releases before Windows 11 24H2.
	if s.input != nil {
		errs = appendCloseError(errs, "close ConPTY input", s.input.Close())
		s.input = nil
	}
	if s.output != nil {
		errs = appendCloseError(errs, "close ConPTY output", s.output.Close())
		s.output = nil
	}
	if s.hpc != 0 {
		closePseudoConsole(s.hpc)
		s.hpc = 0
	}
	if s.job != 0 {
		errs = appendCloseError(errs, "close containment job", windows.CloseHandle(s.job))
		s.job = 0
	}
	if s.process != 0 {
		errs = appendCloseError(errs, "close PowerShell process", windows.CloseHandle(s.process))
		s.process = 0
	}
	return errors.Join(errs...)
}

func waitForProcess(process windows.Handle) processResult {
	status, err := windows.WaitForSingleObject(process, windows.INFINITE)
	if err != nil {
		return processResult{err: fmt.Errorf("wait for PowerShell: %w", err)}
	}
	if status != windows.WAIT_OBJECT_0 {
		return processResult{err: fmt.Errorf("wait for PowerShell: unexpected wait status %d", status)}
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(process, &exitCode); err != nil {
		return processResult{err: fmt.Errorf("read PowerShell exit code: %w", err)}
	}
	return processResult{exitCode: exitCode}
}

func newKillOnCloseJob() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, fmt.Errorf("create containment job: %w", err)
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(job)
		return 0, fmt.Errorf("configure containment job: %w", err)
	}
	return job, nil
}

func currentProcessElevated() (bool, error) {
	var elevation uint32
	var returned uint32
	if err := windows.GetTokenInformation(
		windows.GetCurrentProcessToken(),
		windows.TokenElevation,
		(*byte)(unsafe.Pointer(&elevation)),
		uint32(unsafe.Sizeof(elevation)),
		&returned,
	); err != nil {
		return false, err
	}
	if returned != uint32(unsafe.Sizeof(elevation)) {
		return false, fmt.Errorf("unexpected TOKEN_ELEVATION size %d", returned)
	}
	return elevation != 0, nil
}

func inboxPowerShellPath() (string, error) {
	systemDirectory, err := windows.GetSystemDirectory()
	if err != nil {
		return "", fmt.Errorf("locate Windows system directory: %w", err)
	}
	path := filepath.Join(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe")
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("locate inbox PowerShell: %w", err)
	}
	return path, nil
}

func createPseudoConsole(columns, rows uint16, input, output windows.Handle, hpc *windows.Handle) error {
	result, _, _ := procCreatePseudoConsole.Call(
		packCoord(columns, rows),
		uintptr(input),
		uintptr(output),
		0,
		uintptr(unsafe.Pointer(hpc)),
	)
	return hresultError("CreatePseudoConsole", result)
}

func resizePseudoConsole(hpc windows.Handle, columns, rows uint16) error {
	result, _, _ := procResizePseudoConsole.Call(uintptr(hpc), packCoord(columns, rows))
	return hresultError("ResizePseudoConsole", result)
}

func closePseudoConsole(hpc windows.Handle) {
	procClosePseudoConsole.Call(uintptr(hpc))
}

func packCoord(columns, rows uint16) uintptr {
	return uintptr(uint32(columns) | uint32(rows)<<16)
}

func hresultError(operation string, result uintptr) error {
	status := uint32(result)
	if status == 0 {
		return nil
	}
	return fmt.Errorf("%s failed with HRESULT 0x%08x", operation, status)
}

func closeHandle(handle *windows.Handle) {
	if *handle != 0 {
		_ = windows.CloseHandle(*handle)
		*handle = 0
	}
}

func appendCloseError(errs []error, operation string, err error) []error {
	if err != nil && !errors.Is(err, os.ErrClosed) && !errors.Is(err, windows.ERROR_INVALID_HANDLE) {
		return append(errs, fmt.Errorf("%s: %w", operation, err))
	}
	return errs
}

var _ Session = (*conPTYSession)(nil)
