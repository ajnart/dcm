package cli

import (
	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/host"
)

func (a *program) doctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Check Docker, ports, firewalls and LAN reachability",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			log := a.logger()
			log.Emit(events.Event{Event: events.RunStart, Msg: "doctor"})
			checks := host.Docker(cmd.Context(), a.deps)
			emitChecks(log, checks)
			worst := host.Worst(checks)
			log.Emit(events.Event{Event: events.RunEnd, Msg: "doctor: " + string(worst)})
			if worst == host.Fail {
				return exitError{ExitError}
			}
			return nil
		},
	}
}

func emitChecks(log *events.Logger, checks []host.Check) {
	for _, c := range checks {
		event := events.Event{App: c.App, Step: c.ID, Msg: c.Title + ": " + c.Detail, Hint: c.Hint, Docs: c.Docs}
		switch c.Level {
		case host.OK:
			event.Event = events.StepOK
		case host.Warn:
			event.Event = events.StepWarn
		default:
			event.Event = events.StepFail
		}
		log.Emit(event)
	}
}
