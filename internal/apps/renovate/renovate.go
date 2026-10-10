// Package renovate is Renovate: a dependency-update CLI prepared inert with a
// version probe only and an owner-supplied forge token.
package renovate

import (
	"context"
	"errors"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Renovate. Traps: docs/catalog/traps/renovate.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "renovate", Name: "Renovate", Category: "Developer tools",
		Description:   "Automatically suggest updates for the software your code projects depend on",
		Image:         "ghcr.io/renovatebot/renovate:44.132.2",
		Docs:          "https://docs.renovatebot.com/",
		Port:          0,
		ContainerPort: 0,
		Service:       "renovate",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "token",
		Prompt:   "Forgejo Personal Access Token",
		Help:     "A dedicated Renovate account's token with repository read and pull-request write scope",
		Required: true,
		Private:  true,
	}}
}

func (App) Compose(app.RenderContext) string {
	return `services:
  renovate:
    image: ghcr.io/renovatebot/renovate:44.132.2
    restart: "no"
    command: ["renovate", "--version"]
    environment:
      RENOVATE_AUTODISCOVER: "false"
      RENOVATE_TOKEN: ${RENOVATE_TOKEN}
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "token", "save the Forgejo token for Renovate", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Secret(h.Key("token")) != "", nil },
		Do: func(context.Context) error {
			if h.Inputs["token"] == "" {
				return errors.New("no forge token was provided")
			}
			return h.SetSecret(h.Key("token"), h.Inputs["token"])
		},
		Hint: "Create a dedicated Renovate account and a Personal Access Token in Forgejo (User settings > Applications) " +
			"with repository read and pull-request write scope, then pass it with: self-host install renovate --set-file renovate.token=/path/to/credential",
		Credential: h.Key("token"),
	}); err != nil {
		return err
	}
	h.Info("Renovate is prepared but no repository or scheduler is selected. Before any update run, choose an explicit " +
		"repository allowlist and approve remote writes.")
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("token")) == "" {
		return errors.New("no Renovate token is saved; provide one with: self-host install renovate --set-file renovate.token=/path/to/credential")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
