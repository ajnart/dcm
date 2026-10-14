package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func (a *program) profileCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "profile",
		Short: "Show what self-host remembers about you, such as your Experience level",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			profile, err := a.service().Profile()
			if err != nil {
				return a.fail(err)
			}
			if a.json {
				return writeJSON(a.deps.Out, profile)
			}
			level := profile.Experience
			if level == "" {
				level = "not set (treated as new)"
			}
			fmt.Fprintf(a.deps.Out, "Experience  %s\n", level)
			return nil
		},
	}
	set := &cobra.Command{Use: "set", Short: "Change the Profile"}
	set.AddCommand(&cobra.Command{
		Use:   "experience <new|advanced>",
		Short: "Set your Experience level",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			a.document = true
			if err := a.service().SetExperience(args[0]); err != nil {
				return a.fail(err)
			}
			fmt.Fprintf(a.deps.Out, "Experience level is now %s.\n", args[0])
			return nil
		},
	})
	cmd.AddCommand(set)
	return cmd
}
