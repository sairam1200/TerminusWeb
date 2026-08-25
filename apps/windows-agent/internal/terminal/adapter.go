// Package terminal defines the local terminal lifecycle boundary.
//
// This package intentionally has no transport or protocol concerns. A later,
// contract-gated task can consume Adapter without teaching this package about
// WebSockets or protocol frames.
package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"
)

const (
	DefaultColumns uint16 = 80
	DefaultRows    uint16 = 24
	maxDimension   uint16 = 32767
)

var (
	ErrClosed      = errors.New("terminal session closed")
	ErrElevated    = errors.New("refusing to start a terminal from an elevated process")
	ErrUnsupported = errors.New("ConPTY is supported only on Windows")
)

// Config describes one local terminal session. A zero dimension selects the
// documented default. Timeout zero means the parent context owns the deadline.
type Config struct {
	Columns uint16
	Rows    uint16
	Timeout time.Duration
}

// Session is the internal boundary consumed by a future transport. Output is
// read through Read and UTF-8/virtual-terminal input is sent through Write.
type Session interface {
	io.Reader
	io.Writer
	Resize(columns, rows uint16) error
	Wait() error
	Close() error
}

// Adapter opens local terminal sessions.
type Adapter interface {
	Open(ctx context.Context, cfg Config) (Session, error)
}

// LocalAdapter opens a PowerShell session through the platform ConPTY adapter.
// It does not bind or listen on any network interface.
type LocalAdapter struct{}

func (LocalAdapter) Open(ctx context.Context, cfg Config) (Session, error) {
	if ctx == nil {
		return nil, errors.New("open terminal: nil context")
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("open terminal: %w", err)
	}

	normalized, err := normalizeConfig(cfg)
	if err != nil {
		return nil, err
	}
	return openLocalSession(ctx, normalized)
}

func normalizeConfig(cfg Config) (Config, error) {
	if cfg.Timeout < 0 {
		return Config{}, errors.New("open terminal: timeout must not be negative")
	}
	if cfg.Columns == 0 {
		cfg.Columns = DefaultColumns
	}
	if cfg.Rows == 0 {
		cfg.Rows = DefaultRows
	}
	if cfg.Columns > maxDimension || cfg.Rows > maxDimension {
		return Config{}, fmt.Errorf("open terminal: dimensions must be between 1 and %d", maxDimension)
	}
	return cfg, nil
}
