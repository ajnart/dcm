package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/service"
)

func (a *program) debugCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "debug <app>",
		Short: "Print the Debug report of an App: Status, failed steps, recent logs and its health check",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a.document = true
			report, err := a.service().Debug(cmd.Context(), args[0])
			if err != nil {
				return a.fail(err)
			}
			if a.json {
				return writeJSON(a.deps.Out, report)
			}
			printDebug(a.deps.Out, report)
			return nil
		},
	}
}

func printDebug(w io.Writer, r service.DebugReport) {
	fmt.Fprintf(w, "Debug report: %s (%s)\n", r.Name, r.ID)
	state := r.State
	if r.Health != "" {
		state += " (" + r.Health + ")"
	}
	fmt.Fprintf(w, "State     %s\n", state)
	fmt.Fprintf(w, "Setup     %s\n", r.Setup)
	if r.Image != "" {
		fmt.Fprintf(w, "Image     %s\n", r.Image)
	}
	for _, address := range r.Addresses {
		fmt.Fprintf(w, "Address   %s\n", address)
	}
	if r.Docs != "" {
		fmt.Fprintf(w, "Docs      %s\n", r.Docs)
	}
	if r.DockerError != "" {
		fmt.Fprintf(w, "Docker    unavailable: %s\n", r.DockerError)
		printDockerAdvice(w, r.DockerHint, r.DockerDocs)
	}
	if len(r.FailedSteps) > 0 {
		fmt.Fprintln(w, "\nFailed steps")
		for _, step := range r.FailedSteps {
			fmt.Fprintf(w, "  %-7s %s: %s\n", step.Status, step.ID, step.Msg)
			if step.Error != "" {
				fmt.Fprintf(w, "          error: %s\n", step.Error)
			}
			if step.Hint != "" {
				fmt.Fprintf(w, "          hint: %s\n", step.Hint)
			}
		}
	}
	if r.HealthCheck.URL != "" {
		fmt.Fprintf(w, "\nHealth check\n  URL      %s\n  Working  %s\n", r.HealthCheck.URL, r.HealthCheck.Working)
	}
	fmt.Fprintf(w, "\nLogs (last %d lines)\n", r.LogLines)
	for _, line := range r.Logs {
		fmt.Fprintf(w, "  %s\n", line)
	}
	if r.LogsError != "" {
		fmt.Fprintf(w, "  logs unavailable: %s\n", strings.TrimSpace(r.LogsError))
	}
}

func printDockerAdvice(w io.Writer, hint, docs string) {
	if hint != "" {
		fmt.Fprintf(w, "          %s\n", hint)
	}
	if docs != "" {
		fmt.Fprintf(w, "          Docs: %s\n", docs)
	}
}
