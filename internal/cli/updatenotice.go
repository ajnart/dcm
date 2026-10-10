package cli

import (
	"context"
	"slices"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/release"
	"github.com/ajnart/self-host/internal/updatecheck"
)

// startNotice looks for a newer release alongside a plain command and returns
// the function that yields the one line to print once the command succeeds.
// Nothing runs for the dashboard (which asks for itself), for self-update,
// for --json, off a terminal, in CI, on a development build or when opted out.
func (a *program) startNotice(ctx context.Context, root *cobra.Command, args []string) func() string {
	none := func() string { return "" }
	if !a.deps.Interactive || updatecheck.Disabled(a.deps) || jsonRequested(args) {
		return none
	}
	cmd, _, err := root.Find(args)
	if err != nil || cmd == root || cmd.Name() == "self-update" || cmd.Name() == "help" || cmd.Name() == "completion" {
		return none
	}
	client := release.NewClient(a.deps)
	return updatecheck.StartNoticeContext(ctx, a.deps, func(ctx context.Context) (string, error) {
		rel, err := client.Latest(ctx)
		return rel.Version(), err
	})
}

func jsonRequested(args []string) bool {
	return slices.ContainsFunc(args, func(arg string) bool {
		return arg == "--json" || strings.HasPrefix(arg, "--json=") && !strings.HasSuffix(arg, "=false")
	})
}
