package cli

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/telemetry"
)

// startTelemetry announces Telemetry before a plain command and returns the
// function that reports the command once it is done. Nothing runs for help,
// completion, a bare `self-host` off a terminal or when Telemetry is off.
func (a *program) startTelemetry(root *cobra.Command, args []string) func(err error, code int) {
	none := func(error, int) {}
	cmd, _, err := root.Find(args)
	if err != nil || slices.ContainsFunc(args, func(arg string) bool { return arg == "--help" || arg == "-h" || arg == "--version" }) {
		return none
	}
	name := "dashboard"
	switch {
	case cmd == root && !a.deps.Interactive:
		return none
	case cmd != root && (cmd.Name() == "help" || cmd.Name() == "completion" || strings.HasPrefix(cmd.Name(), "__")):
		return none
	case cmd != root:
		name = strings.TrimPrefix(cmd.CommandPath(), root.Name()+" ")
	}
	tel := service.New(a.deps, events.Discard(), a.catalog).Telemetry()
	if !tel.Enabled() {
		return none
	}
	if cmd != root && !jsonRequested(args) && tel.Announce() {
		fmt.Fprintln(a.deps.Err, telemetry.Notice)
	}
	start := a.deps.Now()
	return func(err error, code int) {
		report := telemetry.Report{
			Command:     name,
			Duration:    a.deps.Now().Sub(start),
			Outcome:     outcomeOf(code),
			FailedSteps: a.steps.Report.FailedSteps,
			Steps:       a.steps.Report.Steps,
			Stack:       a.steps.Report.Stack,
			Panic:       a.panicked,
		}
		if report.Outcome != telemetry.OutcomeOK && report.Outcome != telemetry.OutcomeManual {
			report.Failure = a.failure
			var exit exitError
			if report.Failure == nil && !errors.As(err, &exit) {
				report.Failure = err
			}
		}
		if cmd.Name() == "install" || cmd.Name() == "setup" {
			report.Apps, report.Recipes = a.catalogIDs(cmd.Flags().Args())
			report.Access, _ = cmd.Flags().GetString("exposure")
			if report.Access == service.ExposureLAN {
				report.Access = "home"
			}
		}
		tel.Send(report)
	}
}

// catalogIDs keeps the App and Recipe IDs among args; anything else a person
// typed is dropped, so it can never travel.
func (a *program) catalogIDs(args []string) (apps, recipes []string) {
	for _, arg := range args {
		if _, ok := a.catalog.App(arg); ok {
			apps = append(apps, arg)
		} else if _, ok := a.catalog.Recipe(arg); ok {
			recipes = append(recipes, arg)
		}
	}
	return apps, recipes
}

func outcomeOf(code int) telemetry.Outcome {
	switch code {
	case ExitOK:
		return telemetry.OutcomeOK
	case ExitIncomplete:
		return telemetry.OutcomeIncomplete
	case ExitManual:
		return telemetry.OutcomeManual
	}
	return telemetry.OutcomeFailed
}
