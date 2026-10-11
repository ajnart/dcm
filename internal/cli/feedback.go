package cli

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/telemetry"
)

const (
	issuesURL   = "https://github.com/ajnart/selfhost/issues"
	feedbackAsk = "Send this to the self-host maintainers? y/n "
)

func (a *program) feedbackCmd() *cobra.Command {
	var message, appID string
	var yes bool
	cmd := &cobra.Command{
		Use:   "feedback",
		Short: "Send the maintainers a report of what broke, after the person agrees",
		Long: "Sends a report to the self-host maintainers through Telemetry. The message comes from --message or stdin.\n" +
			"Every known secret is masked, the exact text is shown, and a person is asked y/n.\n" +
			"--yes skips the question: use it only after the person agreed in chat.\n" +
			"It stays off whenever Telemetry is off (SELF_HOST_NO_TELEMETRY=1, DO_NOT_TRACK=1, CI).",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			a.document = true
			text, err := a.feedbackMessage(cmd, message)
			if err != nil {
				return a.fail(err)
			}
			svc := a.service()
			if !svc.Telemetry().Enabled() {
				fmt.Fprintf(a.deps.Err, "Telemetry is off here, so nothing was sent. To send feedback another way, open an issue: %s\n", issuesURL)
				return exitError{ExitError}
			}
			if !yes && !a.deps.Interactive {
				return a.fail(errors.New("nothing was sent: there is no terminal to ask the person on. After they agree, run again with --yes"))
			}
			feedback, err := svc.PrepareFeedback(cmd.Context(), text, appID)
			if err != nil {
				return a.fail(err)
			}
			printFeedback(a.deps.Out, feedback)
			if !yes && !a.ask(feedbackAsk) {
				fmt.Fprintln(a.deps.Out, "Nothing was sent.")
				return nil
			}
			if !svc.SendFeedback(feedback) {
				return a.fail(fmt.Errorf("could not reach the maintainers, so nothing was sent. You can open an issue instead: %s", issuesURL))
			}
			fmt.Fprintln(a.deps.Out, "Sent. Thank you.")
			return nil
		},
	}
	cmd.Flags().StringVarP(&message, "message", "m", "", "what to report (default: read stdin)")
	cmd.Flags().StringVar(&appID, "app", "", "attach a short summary of this App's Debug report (Status, failed steps and hints, no logs)")
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "send without asking: only after the person agreed")
	return cmd
}

func (a *program) feedbackMessage(cmd *cobra.Command, message string) (string, error) {
	if cmd.Flags().Changed("message") {
		return message, nil
	}
	if a.deps.Interactive || a.deps.In == nil {
		return "", errors.New("give the message with --message, or pipe it in on stdin")
	}
	data, err := io.ReadAll(io.LimitReader(a.deps.In, telemetry.MaxFeedbackBytes+1))
	if err != nil {
		return "", fmt.Errorf("cannot read the message from stdin; the limit is %d bytes", telemetry.MaxFeedbackBytes)
	}
	if len(data) > telemetry.MaxFeedbackBytes {
		return "", telemetry.ErrFeedbackTooLarge
	}
	return string(data), nil
}

func printFeedback(w io.Writer, f service.FeedbackText) {
	fmt.Fprintln(w, "This is exactly what will be sent:")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Message")
	indent(w, f.Message)
	if f.Summary != "" {
		fmt.Fprintf(w, "\nSummary of %s\n", f.App)
		indent(w, f.Summary)
	}
	fmt.Fprintln(w, "\nIt also carries the anonymous install ID, the version, the operating system and the architecture.")
	fmt.Fprintln(w)
}

func indent(w io.Writer, text string) {
	for _, line := range strings.Split(text, "\n") {
		fmt.Fprintf(w, "  %s\n", strings.TrimRight(line, "\r"))
	}
}
