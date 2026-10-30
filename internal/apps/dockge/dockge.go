// Package dockge is Dockge: a private Compose manager UI. This recipe keeps the
// Docker socket off the host and leaves stack management to a separate scope.
package dockge

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Dockge. Traps: docs/catalog/traps/dockge.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "dockge", Name: "Dockge", Category: "Containers",
		Description:   "A web page for organising app setups; you give it access to your apps yourself",
		Image:         "docker.io/louislam/dockge:latest",
		Docs:          "https://github.com/louislam/dockge#how-to-install",
		Port:          5001,
		ContainerPort: 5001,
		WebSockets:    true,
		Service:       "dockge",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  dockge:
    image: docker.io/louislam/dockge:latest
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

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{Path: "/"},
		Exists: func(ctx context.Context, h *helpers.H) (bool, error) {
			pending, err := h.SocketIOSetupPending(ctx)
			return !pending, err
		},
		Create: func(ctx context.Context, h *helpers.H, user, password string) error {
			return h.SocketIOCreateAdmin(ctx, user, password)
		},
		Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
			return h.SocketIOLogin(ctx, user, password)
		},
		Manual: "open Dockge and create the first administrator account",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return firstAdmin().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return firstAdmin().Check(ctx, h) }

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, create the first administrator account on the first visit."
}
