package cli

import (
	"bufio"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/service"
)

func (a *program) lifecycleCmds() []*cobra.Command {
	simple := func(use, short string, fn func(cmd *cobra.Command, ids []string) error) *cobra.Command {
		return &cobra.Command{Use: use + " [app...]", Short: short,
			RunE: func(cmd *cobra.Command, args []string) error { return a.fail(fn(cmd, args)) }}
	}
	start := simple("start", "Start Apps (all when none named)", func(cmd *cobra.Command, ids []string) error {
		return a.service().Start(cmd.Context(), ids)
	})
	stop := simple("stop", "Stop Apps (all when none named)", func(cmd *cobra.Command, ids []string) error {
		return a.service().Stop(cmd.Context(), ids)
	})
	up := &cobra.Command{Use: "up", Short: "Start every App in the Project", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return a.fail(a.service().Start(cmd.Context(), nil)) }}
	down := &cobra.Command{Use: "down", Short: "Take down the Project's containers and networks; keep volumes", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error { return a.fail(a.service().Down(cmd.Context())) }}
	restart := simple("restart", "Restart Apps (all when none named)", func(cmd *cobra.Command, ids []string) error {
		return a.service().Restart(cmd.Context(), ids)
	})
	update := simple("update", "Pull newer images, recreate Apps and rerun Check", func(cmd *cobra.Command, ids []string) error {
		return a.service().Update(cmd.Context(), ids)
	})

	var purge, yes bool
	remove := &cobra.Command{
		Use:   "remove <app>...",
		Short: "Remove Apps; data in apps/<id>/ is kept unless --purge",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !yes {
				question := "Remove " + strings.Join(args, ", ") + "?"
				if purge {
					question = "Remove " + strings.Join(args, ", ") + " and DELETE their data?"
				}
				if !a.confirm(question) {
					return a.fail(fmt.Errorf("not confirmed; pass --yes to remove without asking"))
				}
			}
			return a.fail(a.service().Remove(cmd.Context(), args, purge))
		},
	}
	remove.Flags().BoolVar(&purge, "purge", false, "also delete the Apps' data folders")
	remove.Flags().BoolVarP(&yes, "yes", "y", false, "do not ask for confirmation")

	config := &cobra.Command{Use: "config", Short: "Change Host settings"}
	config.AddCommand(a.configReviewCmd(), &cobra.Command{
		Use:   "set KEY=value...",
		Short: "Set Host settings and recreate the Apps that use them (LAN_IP=auto re-detects)",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return a.fail(a.service().ConfigSet(cmd.Context(), args))
		},
	})
	var follow bool
	var tail int
	logs := &cobra.Command{
		Use:   "logs <app>",
		Short: "Print an App's container logs",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			a.document = true
			return a.fail(a.service().Logs(cmd.Context(), args[0], a.deps.Out, follow, tail))
		},
	}
	logs.Flags().BoolVarP(&follow, "follow", "f", false, "keep streaming new lines")
	logs.Flags().IntVar(&tail, "tail", 200, "number of lines to show from the end")
	return []*cobra.Command{start, stop, up, down, restart, update, remove, config, logs}
}

// configReviewCmd re-runs the onboarding review on an existing Project: it
// compares Host settings with a fresh detection and offers to fix drift.
func (a *program) configReviewCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "review",
		Short: "Compare Host settings with this machine now and fix what drifted (LAN IP, time zone)",
		Long: "Re-confirms the onboarding choices of an existing Project. Installed Apps, their data and secrets are kept;\n" +
			"only the Apps that use a changed setting are recreated. Change Exposure or folders with: self-host config set KEY=value",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			review, err := a.service().ReviewSettings(cmd.Context())
			if err != nil {
				return a.fail(err)
			}
			fixes := service.DriftFixes(review)
			if a.json {
				if err := writeJSON(a.deps.Out, map[string]any{"settings": review, "fixes": fixes}); err != nil {
					return err
				}
			} else {
				printReview(a.deps.Out, review, fixes)
			}
			if len(fixes) == 0 || !(yes || a.confirm("Apply "+strings.Join(fixes, " ")+"?")) {
				return nil
			}
			if err := a.service().ConfigSet(cmd.Context(), fixes); err != nil {
				return a.fail(err)
			}
			if !a.json {
				fmt.Fprintln(a.deps.Out, "Applied "+strings.Join(fixes, " ")+"; the Apps that use them were recreated.")
			}
			return nil
		},
	}
	cmd.Flags().BoolVarP(&yes, "yes", "y", false, "apply the fixes without asking")
	return cmd
}

func printReview(w io.Writer, review []service.SettingReview, fixes []string) {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "SETTING\tCURRENT\tTHIS MACHINE NOW\t")
	for _, r := range review {
		mark := ""
		if r.Drift {
			mark = "⚠ " + r.Note
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", r.Key, r.Current, r.Detected, strings.TrimSpace(mark))
	}
	tw.Flush()
	if len(fixes) == 0 {
		fmt.Fprintln(w, "\nNothing drifted. Change a choice with: self-host config set KEY=value")
		return
	}
	fmt.Fprintln(w, "\nTo fix: self-host config review --yes   (or: self-host config set "+strings.Join(fixes, " ")+")")
}

// confirm asks a yes/no question on an interactive terminal.
func (a *program) confirm(question string) bool {
	if !a.deps.Interactive || a.deps.In == nil {
		return false
	}
	fmt.Fprintf(a.deps.Out, "%s [y/N] ", question)
	line, _ := bufio.NewReader(a.deps.In).ReadString('\n')
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes"
}

type inputJSON struct {
	Key      string `json:"key"`
	Prompt   string `json:"prompt"`
	Help     string `json:"help,omitempty"`
	Default  string `json:"default,omitempty"`
	Required bool   `json:"required"`
	Private  bool   `json:"private,omitempty"`
}

type appJSON struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Category    string      `json:"category,omitempty"`
	Image       string      `json:"image"`
	Docs        string      `json:"docs,omitempty"`
	Port        int         `json:"port"`
	Inputs      []inputJSON `json:"inputs"`
	Links       []string    `json:"links,omitempty"`
}

func describe(a app.App) appJSON {
	info := a.Info()
	out := appJSON{ID: info.ID, Name: info.Name, Description: info.Description, Category: info.Category,
		Image: info.Image, Docs: info.Docs, Port: info.Port, Inputs: []inputJSON{}}
	for _, in := range a.Inputs() {
		input := inputJSON{Key: in.Key, Prompt: in.Prompt, Help: in.Help, Default: in.Default, Required: in.Required, Private: in.Private}
		if in.Private {
			input.Default = ""
		}
		out.Inputs = append(out.Inputs, input)
	}
	for _, link := range a.Links() {
		out.Links = append(out.Links, link.Target)
	}
	return out
}

func (a *program) appsCmd() *cobra.Command {
	apps := &cobra.Command{Use: "apps", Short: "Browse the catalog of Apps and Recipes"}
	apps.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List catalog Apps and Recipes",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			type recipeJSON struct {
				ID          string   `json:"id"`
				Name        string   `json:"name"`
				Description string   `json:"description"`
				Apps        []string `json:"apps"`
			}
			out := struct {
				Apps    []appJSON    `json:"apps"`
				Recipes []recipeJSON `json:"recipes"`
			}{Apps: []appJSON{}, Recipes: []recipeJSON{}}
			for _, ap := range a.catalog.Apps() {
				out.Apps = append(out.Apps, describe(ap))
			}
			for _, r := range a.catalog.Recipes() {
				out.Recipes = append(out.Recipes, recipeJSON{ID: r.ID, Name: r.Name, Description: r.Description, Apps: r.Apps})
			}
			if a.json {
				return writeJSON(a.deps.Out, out)
			}
			fmt.Fprintln(a.deps.Out, "Recipes")
			for _, r := range out.Recipes {
				fmt.Fprintf(a.deps.Out, "  %-14s %s (%s)\n", r.ID, r.Description, strings.Join(r.Apps, ", "))
			}
			fmt.Fprintln(a.deps.Out, "\nApps")
			for _, ap := range out.Apps {
				fmt.Fprintf(a.deps.Out, "  %-14s %s\n", ap.ID, ap.Description)
			}
			return nil
		},
	})
	apps.AddCommand(&cobra.Command{
		Use:   "info <app>",
		Short: "Show an App's image, port, inputs and Links",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ap, found := a.catalog.App(args[0])
			if !found {
				return a.fail(fmt.Errorf("unknown app %q (see: self-host apps list)", args[0]))
			}
			info := describe(ap)
			if a.json {
				return writeJSON(a.deps.Out, info)
			}
			fmt.Fprintf(a.deps.Out, "%s — %s\nimage  %s\nport   %d\ndocs   %s\n", info.Name, info.Description, info.Image, info.Port, info.Docs)
			for _, in := range info.Inputs {
				req := ""
				if in.Required {
					req = " (required)"
				}
				if in.Private {
					fmt.Fprintf(a.deps.Out, "input  --set-file %s.%s=PATH%s  %s\n", info.ID, in.Key, req, in.Prompt)
				} else {
					fmt.Fprintf(a.deps.Out, "input  --set %s.%s=…%s  %s\n", info.ID, in.Key, req, in.Prompt)
				}
			}
			return nil
		},
	})
	return apps
}
