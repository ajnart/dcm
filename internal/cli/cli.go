// Package cli maps subcommands onto the Service. Every command can print
// human text or NDJSON events.
package cli

import (
	"context"
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
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
	catalog *catalog.Catalog
	json    bool
	verbose bool
	// document commands print one result document on stdout, so their
	// events go to stderr and only when verbose.
	document bool
	log      *events.Logger
	svc      *service.Service
}

func (a *app) service() *service.Service {
	if a.svc == nil {
		a.svc = service.New(a.deps, a.logger(), a.catalog)
	}
	return a.svc
}

// fail turns a Service error into an exit code, printing it as an event.
func (a *app) fail(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, service.ErrIncomplete) {
		return exitError{ExitIncomplete}
	}
	if a.document {
		fmt.Fprintln(a.deps.Err, "error:", err)
		return exitError{ExitError}
	}
	a.logger().Emit(events.Event{Event: events.RunEnd, Error: err.Error(), Msg: "failed"})
	return exitError{ExitError}
}

func (a *app) logger() *events.Logger {
	if a.log != nil {
		return a.log
	}
	if a.document {
		a.log = events.New()
		if a.verbose {
			a.log.AddSink(events.Human(a.deps.Err, true))
		}
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
	return RunWith(ctx, deps, catalog.Default(), args)
}

// RunWith is Run with an explicit catalog.
func RunWith(ctx context.Context, deps *system.Deps, cat *catalog.Catalog, args []string) int {
	a := &app{deps: deps, catalog: cat}
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
	root.AddCommand(a.doctorCmd(), a.installCmd(), a.setupCmd(), a.statusCmd(), a.credentialsCmd())
	return root
}
