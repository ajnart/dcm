// Package borgmatic is Borgmatic: a Borg backup CLI prepared inert, with cron
// disabled, whose backup and restore still require a reviewed job.
package borgmatic

import (
	"context"
	"errors"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Borgmatic. Traps: docs/catalog/traps/borgmatic.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "borgmatic", Name: "Borgmatic", Category: "Backups",
		Description:   "Back up your files on a schedule, safely encrypted",
		Image:         "ghcr.io/borgmatic-collective/borgmatic:latest",
		Docs:          "https://torsion.org/borgmatic/docs/",
		Port:          0,
		ContainerPort: 0,
		Service:       "borgmatic",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "repository",
		Prompt:   "Borg repository destination",
		Help:     "The repository Borgmatic backs up to, e.g. /mnt/borg-repository or user@host:/path",
		Required: true,
	}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "repository_passphrase", Length: 48}}
}

func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	repository := rc.Inputs["repository"]
	if repository == "" {
		repository = "/mnt/borg-repository"
	}
	config := "source_directories:\n  - /mnt/source\nrepositories:\n  - path: " + repository +
		"\narchive_name_format: 'self-host-{now:%Y-%m-%d-%H%M%S}'\n"
	return []app.File{
		{Path: "config", Content: config},
		{Path: "repository-passphrase", Content: secret("repository_passphrase"), Mode: 0o600},
	}
}

func (App) Compose(app.RenderContext) string {
	return `services:
  borgmatic:
    image: ghcr.io/borgmatic-collective/borgmatic:latest
    restart: "no"
    hostname: self-host-borgmatic
    command: ["borgmatic", "--version"]
    environment:
      CRON: "false"
      BORG_PASSPHRASE_FILE: /run/secrets/repository-passphrase
    volumes:
      - ./source:/mnt/source:ro
      - ./repository:/mnt/borg-repository
      - ./config:/etc/borgmatic.d/config.yaml
      - ./keys:/root/.config/borg
      - ./cache:/root/.cache/borg
      - ./state:/root/.local/state/borgmatic
      - ./repository-passphrase:/run/secrets/repository-passphrase:ro
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "repository", "record the Borg repository destination", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Inputs["repository"] != "", nil },
		Do: func(context.Context) error {
			return errors.New("no repository destination was provided")
		},
		Hint: "Provide the Borg repository to back up to: self-host install borgmatic " +
			"--set borgmatic.repository=<path-or-user@host:/path>. The source folder is apps/borgmatic/source.",
	}); err != nil {
		return err
	}
	h.Info("Borgmatic is prepared but cron is disabled; nothing is backed up yet. Run a reviewed job with " +
		"docker compose exec borgmatic borgmatic --verbosity 1, and prove recovery with an isolated restore.")
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if h.Inputs["repository"] == "" {
		return errors.New("no Borg repository is configured; set it with: self-host install borgmatic --set borgmatic.repository=<path>")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
