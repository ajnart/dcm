// Package cli maps subcommands onto the Service. Every command can print
// human text or NDJSON events.
package cli

import (
	"context"
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
)

// Exit codes.
const (
	ExitOK         = 0
	ExitError      = 1
	ExitIncomplete = 2
)

// exitError carries an exit code out of a command without printing usage.
type exitError struct{ code int }

func (e exitError) Error() string { return fmt.Sprintf("exit %d", e.code) }

type app struct {
	deps    *system.Deps
	json    bool
	verbose bool
	log     *events.Logger
}

func (a *app) logger() *events.Logger {
	if a.log != nil {
		return a.log
	}
	if a.json {
		a.log = events.New(events.JSON(a.deps.Out))
	} else {
		a.log = events.New(events.Human(a.deps.Out, a.verbose))
	}
	return a.log
}

// Run executes the binary with args and returns the exit code.
func Run(ctx context.Context, deps *system.Deps, args []string) int {
	a := &app{deps: deps}
	root := a.root()
	root.SetArgs(args)
	root.SetOut(deps.Out)
	root.SetErr(deps.Err)
	err := root.ExecuteContext(ctx)
	var exit exitError
	switch {
	case err == nil:
		return ExitOK
	case errors.As(err, &exit):
		return exit.code
	default:
		fmt.Fprintln(deps.Err, "error:", err)
		return ExitError
	}
}

func (a *app) root() *cobra.Command {
	root := &cobra.Command{
		Use:           "self-host",
		Short:         "Install and run self-hosted apps with Docker Compose",
		Version:       a.deps.Version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.SetVersionTemplate("{{.Version}}\n")
	root.PersistentFlags().BoolVar(&a.json, "json", false, "print one JSON event per line")
	root.PersistentFlags().BoolVarP(&a.verbose, "verbose", "v", false, "show every command and step start")
	root.AddCommand(a.doctorCmd())
	return root
}
