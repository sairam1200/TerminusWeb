package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"terminus/windows-agent/internal/endpoint"
)

type failingConsoleWriter struct {
	writes int
	failAt int
}

func (w *failingConsoleWriter) Write(data []byte) (int, error) {
	w.writes++
	if w.writes >= w.failAt {
		return 0, errors.New("synthetic display failure")
	}
	return len(data), nil
}

func TestPairingConsoleDisplayFailureFailsClosed(t *testing.T) {
	for _, failure := range []string{"code", "approval"} {
		t.Run(failure, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c := newPairingConsole()
			lines := make(chan string)
			var output, notices io.Writer = io.Discard, io.Discard
			if failure == "code" {
				output = &failingConsoleWriter{failAt: 1}
			} else {
				notices = &failingConsoleWriter{failAt: 2}
			}
			go c.run(ctx, lines, output, notices, func() (string, time.Time, error) { return "synthetic", time.Time{}, nil })
			result := make(chan bool, 1)
			go func() {
				result <- c.approve(ctx, endpoint.PairingApproval{Origin: "origin", ClientInstanceID: "client", DeviceIdentity: "device"})
			}()
			select {
			case approved := <-result:
				if approved {
					t.Fatal("unseen request approved")
				}
			case <-time.After(time.Second):
				t.Fatal("display failure left approval blocked")
			}
			select {
			case <-c.done:
			case <-time.After(time.Second):
				t.Fatal("display failure left console alive")
			}
		})
	}
}

type consoleNotices chan string

type callbackConsoleWriter func([]byte)

func (w callbackConsoleWriter) Write(data []byte) (int, error) { w(data); return len(data), nil }

func TestPairingConsoleCanceledHostRejectsReadyApproval(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lines := make(chan string, 1)
	c := newPairingConsole()
	notices := callbackConsoleWriter(func(data []byte) {
		if strings.Contains(string(data), "Type approve ") {
			command := "approve " + strings.Fields(strings.Split(string(data), "Type approve ")[1])[0]
			// Both select cases become ready before the prompt write returns.
			lines <- command
			cancel()
		}
	})
	go c.run(ctx, lines, io.Discard, notices, func() (string, time.Time, error) { return "synthetic", time.Time{}, nil })
	result := make(chan bool, 1)
	go func() {
		result <- c.approve(context.Background(), endpoint.PairingApproval{Origin: "origin", ClientInstanceID: "client", DeviceIdentity: "device"})
	}()
	select {
	case approved := <-result:
		if approved {
			t.Fatal("shutdown approved ready decision")
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown blocked approval")
	}
}

func (w consoleNotices) Write(data []byte) (int, error) { w <- string(data); return len(data), nil }

func awaitNotice(t *testing.T, notices consoleNotices, contains string) string {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case text := <-notices:
			if strings.Contains(text, contains) {
				return text
			}
		case <-deadline:
			t.Fatal("console notice did not arrive")
		}
	}
}

func approvalCommand(t *testing.T, notices consoleNotices) string {
	t.Helper()
	text := awaitNotice(t, notices, "Type approve ")
	return "approve " + strings.Fields(strings.Split(text, "Type approve ")[1])[0]
}

func TestPairingConsoleRepeatedCodesTimeoutAndStaleApproval(t *testing.T) {
	c := newPairingConsole()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lines := make(chan string)
	notices := make(consoleNotices, 30)
	issued := make(chan struct{}, 10)
	go c.run(ctx, lines, io.Discard, notices, func() (string, time.Time, error) {
		issued <- struct{}{}
		return "synthetic-code-not-a-credential", time.Now().Add(2 * time.Minute), nil
	})
	<-issued
	request := endpoint.PairingApproval{Origin: "https://example.invalid", ClientInstanceID: "browser-a", DeviceIdentity: "device-a"}
	firstCtx, expire := context.WithCancel(ctx)
	first := make(chan bool, 1)
	go func() { first <- c.approve(firstCtx, request) }()
	stale := approvalCommand(t, notices)
	lines <- "pair"
	awaitNotice(t, notices, "pending device")
	select {
	case <-issued:
		t.Fatal("replaced code during pending approval")
	default:
	}
	expire()
	if <-first {
		t.Fatal("expired request approved")
	}
	awaitNotice(t, notices, "approval expired")
	lines <- "pair"
	<-issued
	second := make(chan bool, 1)
	go func() { second <- c.approve(ctx, request) }()
	fresh := approvalCommand(t, notices)
	if stale == fresh {
		t.Fatal("approval identifier reused")
	}
	lines <- stale
	awaitNotice(t, notices, "exact approval command")
	select {
	case <-second:
		t.Fatal("stale command decided successor")
	default:
	}
	lines <- "y"
	awaitNotice(t, notices, "exact approval command")
	select {
	case <-second:
		t.Fatal("unscoped answer decided successor")
	default:
	}
	lines <- fresh
	if !<-second {
		t.Fatal("fresh request did not approve")
	}
	lines <- "pair"
	<-issued
	close(lines)
	select {
	case <-c.done:
	case <-time.After(time.Second):
		t.Fatal("EOF did not stop console")
	}
	if c.approve(ctx, request) {
		t.Fatal("closed console approved")
	}
}

func TestPairingConsoleDenialAndShutdownFailClosed(t *testing.T) {
	for _, stop := range []string{"deny", "shutdown", "eof"} {
		t.Run(stop, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c := newPairingConsole()
			lines := make(chan string)
			notices := make(consoleNotices, 10)
			go c.run(ctx, lines, io.Discard, notices, func() (string, time.Time, error) { return "synthetic", time.Time{}, nil })
			result := make(chan bool, 1)
			go func() {
				result <- c.approve(ctx, endpoint.PairingApproval{Origin: "origin", ClientInstanceID: "client", DeviceIdentity: "device"})
			}()
			approvalCommand(t, notices)
			switch stop {
			case "deny":
				lines <- "deny"
			case "shutdown":
				cancel()
			case "eof":
				close(lines)
			}
			select {
			case approved := <-result:
				if approved {
					t.Fatal("approved after denial/shutdown")
				}
			case <-time.After(time.Second):
				t.Fatal("approval remained blocked")
			}
		})
	}
}

func TestConsoleReaderBoundsInputAndStopsAtEOF(t *testing.T) {
	ctx := context.Background()
	lines := readConsoleLines(ctx, strings.NewReader("pair\ndeny\n"))
	if <-lines != "pair" || <-lines != "deny" {
		t.Fatal("line reader changed commands")
	}
	if _, ok := <-lines; ok {
		t.Fatal("reader did not close after EOF")
	}
	if _, ok := <-readConsoleLines(ctx, strings.NewReader(strings.Repeat("x", 5000))); ok {
		t.Fatal("oversized console input accepted")
	}
}
