package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"terminus/windows-agent/internal/endpoint"
)

type approvalRequest struct {
	ctx      context.Context
	approval endpoint.PairingApproval
	result   chan bool
}

type pairingConsole struct {
	requests chan approvalRequest
	done     chan struct{}
}

type consoleWriter struct {
	io.Writer
	failed bool
}

func (w *consoleWriter) Write(data []byte) (int, error) {
	n, err := w.Writer.Write(data)
	if err != nil || n != len(data) {
		w.failed = true
	}
	return n, err
}

func newPairingConsole() *pairingConsole {
	return &pairingConsole{requests: make(chan approvalRequest), done: make(chan struct{})}
}

func (c *pairingConsole) approve(ctx context.Context, approval endpoint.PairingApproval) bool {
	if c == nil || ctx == nil || approval.Origin == "" || approval.ClientInstanceID == "" || approval.DeviceIdentity == "" {
		return false
	}
	request := approvalRequest{ctx: ctx, approval: approval, result: make(chan bool, 1)}
	select {
	case c.requests <- request:
	case <-ctx.Done():
		return false
	case <-c.done:
		return false
	}
	select {
	case result := <-request.result:
		return result && ctx.Err() == nil
	case <-ctx.Done():
		return false
	case <-c.done:
		return false
	}
}

// Exactly one reader owns stdin. Expiring an approval never closes stdin or
// starts a second reader. The process owns the attached console's lifetime.
func readConsoleLines(ctx context.Context, input io.Reader) <-chan string {
	lines := make(chan string)
	go func() {
		defer close(lines)
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 1024), 4096)
		for scanner.Scan() {
			select {
			case lines <- scanner.Text():
			case <-ctx.Done():
				return
			}
		}
	}()
	return lines
}

func (c *pairingConsole) run(ctx context.Context, lines <-chan string, output, notices io.Writer, issue func() (string, time.Time, error)) {
	defer close(c.done)
	codeOutput, noticeOutput := &consoleWriter{Writer: output}, &consoleWriter{Writer: notices}
	output, notices = codeOutput, noticeOutput
	var pending *approvalRequest
	var expired <-chan struct{}
	var approvalID string
	finish := func(approved bool) {
		if pending != nil {
			pending.result <- approved && pending.ctx.Err() == nil && ctx.Err() == nil
		}
		pending, expired, approvalID = nil, nil, ""
	}
	defer func() { finish(false) }()
	printCode := func() {
		if ctx.Err() != nil {
			return
		}
		code, _, err := issue()
		if err != nil {
			fmt.Fprintln(notices, "Pairing code unavailable.")
			return
		}
		fmt.Fprintln(output, code)
		fmt.Fprintln(notices, "Code expires in two minutes and works once. Type pair for another device or replacement code.")
	}
	printCode()
	for {
		// If a prompt cannot be displayed, nobody may approve an unseen request.
		if codeOutput.failed || noticeOutput.failed {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-expired:
			finish(false)
			fmt.Fprintln(notices, "Pairing approval expired. Type pair to try again.")
		case request := <-c.requests:
			if request.ctx.Err() != nil {
				request.result <- false
				continue
			}
			if pending != nil {
				request.result <- false
				continue
			}
			var nonce [16]byte
			if _, err := rand.Read(nonce[:]); err != nil {
				request.result <- false
				continue
			}
			approvalID = hex.EncodeToString(nonce[:])
			pending, expired = &request, request.ctx.Done()
			fmt.Fprintf(notices, "Pairing request origin=%s client=%s device=%s\nType approve %s to authorize this device, or deny.\n", request.approval.Origin, request.approval.ClientInstanceID, request.approval.DeviceIdentity, approvalID)
		case line, ok := <-lines:
			if !ok {
				return
			}
			line = strings.TrimSpace(line)
			// Context cancellation may race this select. A stale decision must
			// never become approval, even before the expiry case is selected.
			if pending != nil && pending.ctx.Err() != nil {
				finish(false)
			}
			switch {
			case line == "pair":
				if pending != nil {
					fmt.Fprintln(notices, "Approve or deny the pending device before issuing another code.")
					continue
				}
				printCode()
			case line == "deny":
				finish(false)
			case pending != nil && line == "approve "+approvalID:
				finish(true)
			default:
				fmt.Fprintln(notices, "Type pair, deny, or the exact approval command shown for the pending device.")
			}
		}
	}
}
