// Package dockge is Dockge: a private Compose manager UI. This recipe keeps the
// Docker socket off the host and leaves stack management to a separate scope.
package dockge

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Dockge. Traps: docs/catalog/traps/dockge.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "dockge", Name: "Dockge", Category: "Containers",
		Description:   "Manages your Compose stacks from a private web interface",
		Image:         "docker.io/louislam/dockge:1.5.0",
		Docs:          "https://github.com/louislam/dockge#how-to-install",
		Port:          5001,
		ContainerPort: 5001,
		Service:       "dockge",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  dockge:
    image: docker.io/louislam/dockge:1.5.0
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      DOCKGE_STACKS_DIR: /app/data/stacks
      DOCKGE_ENABLE_CONSOLE: "false"
    volumes:
      - ./data:/app/data
    ports:
      - ${BIND_IP}:` + port + `:5001
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return (onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/"},
		Manual: "open Dockge and create the first administrator account",
	}).Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return (onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/"},
		Manual: "open Dockge and create the first administrator account",
	}).Check(ctx, h)
}

func (App) Links() []app.Link { return nil }
