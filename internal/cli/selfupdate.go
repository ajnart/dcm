package cli

import (
	"errors"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/release"
)

const installScript = "curl -fsSL https://raw.githubusercontent.com/ajnart/self-host/main/install.sh | bash"

func releaseClient(a *program) release.Client {
	return release.Client{HTTP: a.deps.HTTP, BaseURL: a.deps.Getenv(release.EnvAPI)}
}

func (a *program) selfUpdateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "self-update",
		Short: "Replace this binary with the latest release after checking its checksum",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			log := a.logger()
			log.Emit(events.Event{Event: events.RunStart, Msg: "self-update"})
			current := a.deps.Version
			if !release.IsRelease(current) {
				return a.fail(fmt.Errorf("this is a development build (%s); install a release instead: %s", current, installScript))
			}
			rel, err := releaseClient(a).Latest(cmd.Context())
			if err != nil {
				return a.fail(err)
			}
			newer, err := release.Newer(current, rel.Tag)
			if err != nil {
				return a.fail(err)
			}
			if !newer {
				log.Emit(events.Event{Event: events.RunEnd, Msg: fmt.Sprintf("self-host %s is up to date (latest release %s)", current, rel.Version())})
				return nil
			}
			exe, err := a.deps.Executable()
			if err != nil {
				return a.fail(errors.New("cannot locate the running binary: " + err.Error()))
			}
			log.Emit(events.Event{Event: events.StepStart, Step: "download", Msg: fmt.Sprintf("self-host %s for %s/%s", rel.Version(), a.deps.GOOS, a.deps.GOARCH)})
			if err := releaseClient(a).Install(cmd.Context(), rel, a.deps.GOOS, a.deps.GOARCH, exe); err != nil {
				return a.fail(err)
			}
			log.Emit(events.Event{Event: events.StepOK, Step: "download", Msg: "checksum verified"})
			log.Emit(events.Event{Event: events.RunEnd, Msg: fmt.Sprintf("updated self-host %s → %s", current, rel.Version())})
			return nil
		},
	}
}
