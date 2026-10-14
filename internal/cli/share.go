package cli

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

const shareSite = "https://self-host.fyi/"

func (a *program) shareCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "share",
		Short: "Print a postable install line and site link for the Catalog Apps you run",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			a.document = true
			ids, err := a.service().ShareApps()
			if err != nil {
				return a.fail(err)
			}
			var install, url string
			if len(ids) > 0 {
				list := strings.Join(ids, ",")
				install = "self-host install " + strings.Join(ids, " ")
				url = shareSite + "?apps=" + list + "#play"
			}
			if a.json {
				return writeJSON(a.deps.Out, map[string]string{"install": install, "url": url})
			}
			if len(ids) == 0 {
				fmt.Fprintln(a.deps.Out, "No Apps to share yet; run: self-host install <app|recipe>")
				return nil
			}
			fmt.Fprintln(a.deps.Out, install)
			fmt.Fprintln(a.deps.Out, url)
			return nil
		},
	}
}
