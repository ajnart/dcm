package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/telemetry"
)

func (a *program) appRequestCmd() *cobra.Command {
	var homepage string
	cmd := &cobra.Command{
		Use:   "request <name>",
		Short: "Tell the maintainers an App is wanted that the Catalog lacks (for agents)",
		Long: "For an agent whose person wants an App that is not in the Catalog: sends one anonymous Telemetry event with the App's name\n" +
			"and, with --url, only the host of its URL. No personal data. A person asks for an App by opening a GitHub issue instead.\n" +
			"It sends nothing whenever Telemetry is off (SELF_HOST_NO_TELEMETRY=1, DO_NOT_TRACK=1, CI), and exits 0.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			request, err := telemetry.NewAppRequest(args[0], homepage)
			if err != nil {
				return a.fail(err)
			}
			if id, found := a.catalogApp(request.Name); found {
				fmt.Fprintf(a.deps.Out, "%s is already in the Catalog. Install it with: self-host install %s\n", id, id)
				return nil
			}
			tel := a.service().Telemetry()
			if !tel.Enabled() {
				fmt.Fprintf(a.deps.Out, "Telemetry is off here, so nothing was sent. To ask for %q, open an issue: %s\n", request.Name, issuesURL)
				return nil
			}
			if tel.Announce() {
				fmt.Fprintln(a.deps.Err, telemetry.Notice)
			}
			if !tel.SendAppRequest(request) {
				fmt.Fprintf(a.deps.Out, "Nothing was sent for %q. To ask for it, open an issue: %s\n", request.Name, issuesURL)
				return nil
			}
			fmt.Fprintf(a.deps.Out, "Noted: %q was requested anonymously.\n", request.Name)
			if a.deps.Interactive {
				fmt.Fprintf(a.deps.Out, "To follow it up, open an issue: %s\n", issuesURL)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&homepage, "url", "", "the App's homepage (only its host is sent)")
	return cmd
}

// catalogApp finds the Catalog App a normalised name stands for, by ID or name.
func (a *program) catalogApp(name string) (string, bool) {
	slug := strings.ReplaceAll(name, " ", "-")
	for _, ap := range a.catalog.Apps() {
		info := ap.Info()
		if info.ID == name || info.ID == slug || strings.ToLower(info.Name) == name {
			return info.ID, true
		}
	}
	return "", false
}
