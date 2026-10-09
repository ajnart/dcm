package tui

import (
	"context"

	tea "charm.land/bubbletea/v2"
)

// Run opens the dashboard until the user quits.
func Run(ctx context.Context, backend Backend, opts Options) error {
	final, err := tea.NewProgram(New(backend, opts), tea.WithContext(ctx)).Run()
	if err != nil {
		return err
	}
	// The terminal is back to normal here, so the new binary starts clean.
	if m, ok := final.(Model); ok {
		return restartIfUpdated(m, backend)
	}
	return nil
}
