package terminal

import (
	"context"
	"errors"
	"runtime"
	"testing"
	"time"
)

func TestNormalizeConfigDefaults(t *testing.T) {
	got, err := normalizeConfig(Config{})
	if err != nil {
		t.Fatalf("normalizeConfig: %v", err)
	}
	if got.Columns != DefaultColumns || got.Rows != DefaultRows {
		t.Fatalf("defaults = %dx%d, want %dx%d", got.Columns, got.Rows, DefaultColumns, DefaultRows)
	}
}

func TestNormalizeConfigBoundaries(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{name: "minimum", cfg: Config{Columns: 1, Rows: 1}},
		{name: "maximum", cfg: Config{Columns: maxDimension, Rows: maxDimension}},
		{name: "column overflow", cfg: Config{Columns: maxDimension + 1, Rows: 1}, wantErr: true},
		{name: "row overflow", cfg: Config{Columns: 1, Rows: maxDimension + 1}, wantErr: true},
		{name: "negative timeout", cfg: Config{Timeout: -time.Nanosecond}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := normalizeConfig(tt.cfg)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeConfig error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestOpenRejectsNilAndCanceledContext(t *testing.T) {
	adapter := LocalAdapter{}
	if _, err := adapter.Open(nil, Config{}); err == nil {
		t.Fatal("Open(nil) succeeded")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := adapter.Open(ctx, Config{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("Open(canceled) error = %v, want context.Canceled", err)
	}
}

func TestUnsupportedPlatformFailsClosed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows exercises the real adapter")
	}
	_, err := (LocalAdapter{}).Open(context.Background(), Config{})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("Open error = %v, want ErrUnsupported", err)
	}
}
