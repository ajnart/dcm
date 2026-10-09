package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/service"
)

func (a *program) installCmd() *cobra.Command {
	var opts service.InstallOptions
	var yes bool
	cmd := &cobra.Command{
		Use:   "install <app|recipe>...",
		Short: "Install Apps or Recipes and run their Setup",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes && !a.deps.Interactive {
				return a.fail(fmt.Errorf("pass --yes to install without the interactive review"))
			}
			opts.Targets = args
			if opts.AdminPassword == "" {
				opts.AdminPassword = a.deps.Getenv("SELF_HOST_ADMIN_PASSWORD")
			}
			err := a.service().Install(cmd.Context(), opts)
			if err == nil || isIncomplete(err) {
				a.recap(cmd)
			}
			return a.fail(err)
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "install without asking for confirmation")
	cmd.Flags().StringArrayVar(&opts.Sets, "set", nil, "input as app.key=value or key=value (repeatable); app.port=N picks a port")
	cmd.Flags().StringArrayVar(&opts.SetFiles, "set-file", nil, "private input as app.key=PATH to an owner-only credential file (repeatable)")
	cmd.Flags().StringVar(&opts.Exposure, "exposure", "", "lan (default) or local, for a new Project")
	cmd.Flags().StringVar(&opts.MediaRoot, "media-root", "", "media library folder, for a new Project")
	cmd.Flags().StringVar(&opts.DownloadsRoot, "downloads-root", "", "downloads folder, for a new Project")
	cmd.Flags().StringVar(&opts.AdminUser, "admin-user", "", "Admin login username (default admin)")
	return cmd
}

func isIncomplete(err error) bool {
	return err != nil && strings.Contains(err.Error(), service.ErrIncomplete.Error())
}

func (a *program) setupCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "setup [app...]",
		Short: "Rerun Setup; finished steps are skipped",
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.fail(a.service().Setup(cmd.Context(), args))
		},
	}
}

// recap prints status after a change, unless output is JSON events.
func (a *program) recap(cmd *cobra.Command) {
	if a.json {
		return
	}
	status, err := a.service().Status(cmd.Context())
	if err != nil {
		return
	}
	fmt.Fprintln(a.deps.Out)
	printStatus(a.deps.Out, status)
}

func (a *program) statusCmd() *cobra.Command {
	var updates bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show Exposure, Host settings and every App's URL, state and Setup",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			status, err := a.service().Status(cmd.Context())
			if err != nil {
				return a.fail(err)
			}
			if updates {
				a.service().CheckUpdates(cmd.Context(), &status)
			}
			if a.json {
				return writeJSON(a.deps.Out, status)
			}
			printStatus(a.deps.Out, status)
			return nil
		},
	}
	cmd.Flags().BoolVar(&updates, "updates", false, "also ask registries whether newer images exist")
	return cmd
}

func writeJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func printStatus(w io.Writer, s service.Status) {
	fmt.Fprintf(w, "Project   %s\n", s.Project)
	exposure := "local network (other devices can connect)"
	if s.Exposure == service.ExposureLocal {
		exposure = "this machine only (other devices cannot connect)"
	}
	fmt.Fprintf(w, "Exposure  %s\n", exposure)
	fmt.Fprintf(w, "LAN IP    %s\n", s.LANIP)
	if s.LANIPStale {
		fmt.Fprintf(w, "          ⚠ not an address of this machine any more (now %s); App URLs do not work.\n", strings.Join(s.HostIPs, ", "))
		fmt.Fprintf(w, "          Fix: self-host config set LAN_IP=auto\n")
	}
	fmt.Fprintf(w, "Settings  TZ=%s PUID=%s PGID=%s UMASK=%s\n", s.Settings["TZ"], s.Settings["PUID"], s.Settings["PGID"], s.Settings["UMASK"])
	if s.DockerError != "" {
		fmt.Fprintf(w, "Docker    unavailable: %s\n", s.DockerError)
	}
	fmt.Fprintln(w)
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "APP\tURL\tSTATE\tHEALTH\tSETUP\tUPDATE")
	for _, app := range s.Apps {
		health := app.Health
		if health == "" {
			health = "-"
		}
		fmt.Fprintf(tw, "%s %s\t%s\t%s\t%s\t%s\t%s\n", dot(app), app.ID, app.URL, app.State, health, app.Setup, app.Update)
	}
	tw.Flush()
	for _, app := range s.Apps {
		for _, step := range app.Steps {
			if step.Status == "fail" {
				fmt.Fprintf(w, "\n✗ %s › %s: %s\n  → %s\n", app.ID, step.ID, step.Error, step.Hint)
			}
		}
	}
}

// dot is the coloured status marker used by status and the dashboard.
func dot(app service.AppStatus) string {
	switch service.Level(app) {
	case "ok":
		return "\x1b[32m●\x1b[0m"
	case "attention":
		return "\x1b[33m●\x1b[0m"
	default:
		return "\x1b[31m●\x1b[0m"
	}
}

func (a *program) credentialsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "credentials",
		Short: "Print the Admin login and per-App API keys",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			creds, err := a.service().Credentials(cmd.Context())
			if err != nil {
				return a.fail(err)
			}
			if a.json {
				return writeJSON(a.deps.Out, creds)
			}
			fmt.Fprintf(a.deps.Out, "Shared Admin login\n  user      %s\n  password  %s\n", creds.Admin.Username, creds.Admin.Password)
			ids := make([]string, 0, len(creds.Admin.Aliases))
			for id := range creds.Admin.Aliases {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			for _, id := range ids {
				fmt.Fprintf(a.deps.Out, "  alias     %s %s\n", id, creds.Admin.Aliases[id])
			}
			for id, values := range creds.Apps {
				fmt.Fprintf(a.deps.Out, "\n%s\n", id)
				for key, value := range values {
					fmt.Fprintf(a.deps.Out, "  %s  %s\n", key, value)
				}
			}
			fmt.Fprintf(a.deps.Out, "\nStored in %s (mode 0600).\n", "secrets.env")
			return nil
		},
	}
}
