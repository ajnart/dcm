package tui

import (
	"context"

	tea "charm.land/bubbletea/v2"
)

// Run opens the dashboard until the user quits.
func Run(ctx context.Context, backend Backend, opts Options) error {
	_, err := tea.NewProgram(New(backend, opts), tea.WithContext(ctx)).Run()
	return err
}
