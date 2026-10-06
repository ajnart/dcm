package cli

import (
	"bufio"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/app"
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
	config.AddCommand(&cobra.Command{
		Use:   "set KEY=value...",
		Short: "Set Host settings and recreate the Apps that use them",
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
	return []*cobra.Command{start, stop, restart, update, remove, config, logs}
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
		out.Inputs = append(out.Inputs, inputJSON{Key: in.Key, Prompt: in.Prompt, Help: in.Help, Default: in.Default, Required: in.Required})
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
				fmt.Fprintf(a.deps.Out, "input  --set %s.%s=…%s  %s\n", info.ID, in.Key, req, in.Prompt)
			}
			return nil
		},
	})
	return apps
}
