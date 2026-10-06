package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/skill"
)

func (a *program) skillCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "skill",
		Short: "Print the agent guide that matches this binary",
		Args:  cobra.NoArgs,
		Run: func(*cobra.Command, []string) {
			fmt.Fprint(a.deps.Out, skill.Guide(a.deps.Version))
		},
	}
}
