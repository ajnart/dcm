// Package restic is restic: a backup CLI prepared inert, with its repository
// password in a private file and no schedule of its own.
package restic

import (
	"context"
	"errors"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is restic. Traps: docs/catalog/traps/restic.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "restic", Name: "restic", Category: "Backups",
		Description:   "Back up your files with encryption, and restore them when you need them",
		Image:         "ghcr.io/restic/restic:latest",
		Docs:          "https://restic.readthedocs.io/en/stable/",
		Port:          0,
		ContainerPort: 0,
		Service:       "restic",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "repository",
		Prompt:   "restic repository destination",
		Help:     "The repository restic writes snapshots to, e.g. /repository or s3:s3.example.com/bucket",
		Required: true,
	}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "repository_password", Length: 48}}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "repository-password", Content: secret("repository_password"), Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	repository := rc.Inputs["repository"]
	if repository == "" {
		repository = "/repository"
	}
	return `services:
  restic:
    image: ghcr.io/restic/restic:latest
    restart: "no"
    hostname: self-host-restic
    command: ["version"]
    environment:
      RESTIC_REPOSITORY: ` + repository + `
      RESTIC_PASSWORD_FILE: /run/secrets/repository-password
    volumes:
      - ./source:/source:ro
      - ./repository:/repository
      - ./repository-password:/run/secrets/repository-password:ro
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "repository", "record the restic repository destination", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Inputs["repository"] != "", nil },
		Do: func(context.Context) error {
			return errors.New("no repository destination was provided")
		},
		Hint: "Provide the restic repository to write snapshots to: self-host install restic " +
			"--set restic.repository=<path-or-backend-url>. The source folder is apps/restic/source.",
	}); err != nil {
		return err
	}
	h.Info("restic is prepared but no schedule is configured and no snapshot has run. Keep the repository password " +
		"privately for recovery, then prove recovery with an isolated restore.")
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if h.Inputs["repository"] == "" {
		return errors.New("no restic repository is configured; set it with: self-host install restic --set restic.repository=<path>")
	}
	if h.Secret(h.Key("repository_password")) == "" {
		return errors.New("the restic repository password is missing from secrets.env")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
