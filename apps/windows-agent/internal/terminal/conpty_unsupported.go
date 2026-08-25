//go:build !windows

package terminal

import "context"

func openLocalSession(context.Context, Config) (Session, error) {
	return nil, ErrUnsupported
}
