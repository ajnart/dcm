// Package netdata manages private monitoring with scoped startup and backup handling.
package netdata

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Netdata. Traps: docs/catalog/traps/netdata.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "netdata", Name: "Netdata", Category: "Monitoring",
		Description:   "A private real-time dashboard for the health and performance of this container.",
		Image:         "netdata/netdata:v2.11.0",
		Docs:          "https://learn.netdata.cloud/docs/netdata-agent/installation/docker",
		Port:          19999,
		ContainerPort: 19999,
		Service:       "netdata",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  netdata:
    image: netdata/netdata:v2.11.0
    restart: unless-stopped
    init: true
    entrypoint: ["/bin/sh", "/run/selfhost/netdata-start.sh"]
    environment:
      DISABLE_TELEMETRY: "1"
    volumes:
      - ./config:/etc/netdata
      - ./lib:/var/lib/netdata
      - ./cache:/var/cache/netdata
      - ./startup.sh:/run/selfhost/netdata-start.sh:ro
    ports:
      - ${BIND_IP}:` + port + `:19999
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return onboard.NoAccount{Probe: onboard.Probe{Path: "/api/v1/info"}}.Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return onboard.NoAccount{Probe: onboard.Probe{Path: "/api/v1/info"}}.Check(ctx, h)
}

func (App) Links() []app.Link { return nil }
