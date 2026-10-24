package tui

import (
	"context"
	"fmt"
	"os"

	tea "charm.land/bubbletea/v2"
)

// Run opens the dashboard until the user quits.
func Run(ctx context.Context, backend Backend, opts Options) error {
	m := New(backend, opts)
	defer m.cancelFrames()
	final, err := tea.NewProgram(m, tea.WithContext(ctx)).Run()
	if err != nil {
		m.tasks.cancelAll()
		m.tasks.waitExited(quitGrace)
		return err
	}
	// The terminal is back to normal here, so the new binary starts clean.
	if m, ok := final.(Model); ok {
		if m.interrupted != "" {
			fmt.Fprintln(os.Stderr, m.interrupted)
		}
		return restartIfUpdated(m, backend)
	}
	return nil
}
