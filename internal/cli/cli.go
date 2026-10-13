// Package cli maps subcommands onto the Service. Every command can print
// human text or NDJSON events.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/term"
	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/tui"
	"github.com/ajnart/self-host/internal/updatecheck"
)

// Exit codes.
const (
	ExitOK         = 0
	ExitError      = 1
	ExitIncomplete = 2
	ExitManual     = 3
)

// exitError carries an exit code out of a command without printing usage.
type exitError struct{ code int }

func (e exitError) Error() string { return fmt.Sprintf("exit %d", e.code) }

type program struct {
	deps    *system.Deps
	catalog *catalog.Catalog
	json    bool
	verbose bool
	// args are the command line after the program name.
	args []string
	// document commands print one result document on stdout, so their
	// events go to stderr and only when verbose.
	document bool
	log      *events.Logger
	svc      *service.Service
	// terminal is the interactive sink, closed when the command returns.
	terminal *activity.TerminalSink
	// steps, failure and panicked are what Telemetry learns of a failed command.
	steps    telemetry.Progress
	failure  error
	panicked any
	// experience is the Experience level a command saved, for Telemetry's person property.
	experience string
}

func (a *program) service() *service.Service {
	if a.svc == nil {
		a.svc = service.New(a.deps, a.logger(), a.catalog)
	}
	return a.svc
}

// fail turns a Service error into an exit code, printing it as an event.
func (a *program) fail(err error) error {
	if err == nil {
		return nil
	}
	a.failure = err
	if a.steps.Report.Stack == nil {
		a.steps.Report.Stack = telemetry.CaptureStack(1)
	}
	if errors.Is(err, service.ErrIncomplete) {
		return exitError{ExitIncomplete}
	}
	if errors.Is(err, service.ErrManual) {
		return exitError{ExitManual}
	}
	if a.document {
		fmt.Fprintln(a.deps.Err, "error:", err)
		return exitError{ExitError}
	}
	a.logger().Emit(events.Event{Event: events.RunEnd, Error: err.Error(), Msg: "failed"})
	return exitError{ExitError}
}

func (a *program) logger() *events.Logger {
	if a.log == nil {
		a.log = a.newLogger()
		a.log.AddSink(&a.steps)
	}
	return a.log
}

func (a *program) newLogger() *events.Logger {
	if a.document {
		log := events.New()
		if a.verbose {
			log.AddSink(a.human(a.deps.Err, true))
		}
		return log
	}
	if a.json {
		return events.New(events.JSON(a.deps.Out))
	}
	return events.New(a.human(a.deps.Out, a.verbose))
}

// human prints events as plain lines, or on an interactive terminal with the
// running Action drawn below them and redrawn in place. Anything that is not a terminal,
// and a dumb terminal that cannot move the cursor, gets the plain lines.
func (a *program) human(w io.Writer, verbose bool) events.Sink {
	f, ok := w.(*os.File)
	if !a.deps.Interactive || !ok || !term.IsTerminal(f.Fd()) {
		return events.Human(w, verbose)
	}
	profiled := colorprofile.NewWriter(f, os.Environ())
	if profiled.Profile <= colorprofile.NoTTY {
		return events.Human(w, verbose)
	}
	if a.deps.Getenv("NO_COLOR") != "" {
		profiled.Profile = min(profiled.Profile, colorprofile.ASCII)
	}
	width := func() int {
		if cols, _, err := term.GetSize(f.Fd()); err == nil && cols > 0 {
			return cols
		}
		return 80
	}
	palette := tui.Palette(lipgloss.HasDarkBackground(os.Stdin, f))
	a.terminal = activity.Terminal(profiled, verbose, width, a.glyphs(), palette)
	return a.terminal
}

// glyphs is the Project's glyph set, or Simple when there is no Project or
// its appearance cannot be read.
func (a *program) glyphs() activity.Glyphs {
	appearance, err := service.New(a.deps, events.Discard(), a.catalog).Appearance()
	if err != nil {
		return activity.Simple
	}
	return activity.ParseGlyphs(appearance.Glyphs)
}

// Run executes the binary with args and returns the exit code.
func Run(ctx context.Context, deps *system.Deps, args []string) int {
	return RunWith(ctx, deps, catalog.Default(), args)
}

// RunWith is Run with an explicit catalog.
func RunWith(ctx context.Context, deps *system.Deps, cat *catalog.Catalog, args []string) int {
	a := &program{deps: deps, catalog: cat, args: args, steps: telemetry.Progress{Now: deps.Now, KnownApp: func(id string) bool { _, ok := cat.App(id); return ok }}}
	return a.run(ctx)
}

func (a *program) run(ctx context.Context) int {
	return a.runWithNotice(ctx, a.startNotice)
}

func (a *program) runWithNotice(ctx context.Context, startNotice func(context.Context, *cobra.Command, []string) func() string) int {
	deps, args := a.deps, a.args
	root := a.root()
	root.SetArgs(args)
	root.SetOut(deps.Out)
	root.SetErr(deps.Err)
	noticeCtx, abandonNotice := context.WithCancel(ctx)
	defer abandonNotice()
	notice := startNotice(noticeCtx, root, args)
	rejectNotice := func() {
		abandonNotice()
		notice()
	}
	report := a.startTelemetry(root, args)
	defer func() {
		if crash := recover(); crash != nil {
			stack := telemetry.CaptureStack(1)
			if captured, ok := crash.(system.CapturedPanic); ok {
				crash, stack = captured.Value, telemetry.Stack(captured.Stack)
			}
			system.CatchPanic(rejectNotice)
			a.reportPanic(report, crash, stack)
			panic(crash)
		}
	}()
	err := root.ExecuteContext(ctx)
	if err != nil {
		rejectNotice()
	}
	if a.terminal != nil {
		a.terminal.Close()
	}
	var exit exitError
	code := ExitOK
	switch {
	case err == nil:
		if line := notice(); line != "" && !a.json {
			fmt.Fprintln(deps.Err, line)
		}
	case errors.As(err, &exit):
		code = exit.code
	default:
		fmt.Fprintln(deps.Err, "error:", err)
		code = ExitError
	}
	report(err, code)
	return code
}

func (a *program) reportPanic(report func(error, int), crash any, stack telemetry.Stack) {
	if a.terminal != nil {
		system.CatchPanic(a.terminal.Close)
	}
	a.panicked = crash
	a.steps.Report.Stack = stack
	report(nil, ExitError)
}

// NewRootCommand returns the cobra command tree, for tests that inspect what
// the binary registers.
func NewRootCommand(deps *system.Deps, cat *catalog.Catalog) *cobra.Command {
	return (&program{deps: deps, catalog: cat}).root()
}

func (a *program) root() *cobra.Command {
	root := &cobra.Command{
		Use:           "self-host",
		Short:         "Install and run self-hosted apps with Docker Compose",
		Version:       a.deps.Version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.SetVersionTemplate("{{.Version}}\n")
	root.RunE = func(cmd *cobra.Command, args []string) error {
		if !a.deps.Interactive || a.json {
			return cmd.Help()
		}
		backend := tui.ServiceBackend{Deps: a.deps, Apps: a.catalog, Args: a.args}
		return tui.Run(cmd.Context(), backend, tui.Options{Version: a.deps.Version, NoColor: a.deps.Getenv("NO_COLOR") != "", ReducedMotion: a.deps.Getenv("SELF_HOST_REDUCED_MOTION") != "", NoUpdatePrompt: updatecheck.Disabled(a.deps)})
	}
	root.PersistentFlags().BoolVar(&a.json, "json", false, "print one JSON event per line")
	root.PersistentFlags().BoolVarP(&a.verbose, "verbose", "v", false, "show every command and step start")
	root.AddCommand(a.doctorCmd(), a.hostCmd(), a.accessCmd(), a.installCmd(), a.setupCmd(), a.statusCmd(), a.profileCmd(), a.debugCmd(), a.credentialsCmd(), a.appsCmd(), a.skillCmd(), a.feedbackCmd(), a.selfUpdateCmd())
	root.AddCommand(a.lifecycleCmds()...)
	root.AddCommand(a.cloudflareCmd())
	root.AddCommand(a.backupCmds()...)
	return root
}
