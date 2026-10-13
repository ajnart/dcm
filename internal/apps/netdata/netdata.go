// Package netdata manages private monitoring with scoped startup and backup handling.
package netdata

import (
	"context"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Netdata. Traps: docs/catalog/traps/netdata.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "netdata", Name: "Netdata", Category: "Monitoring",
		Description:   "Watch local monitoring data and active alerts",
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
	attempt := func(ctx context.Context) (bool, error) {
		err := VerifyHomarr(ctx, h)
		return err == nil, err
	}
	return h.Step(ctx, "ready", "verify local Netdata alerts and fresh agent metrics", helpers.StepSpec{
		Check: attempt,
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, attempt)
		},
		Hint: "Read self-host logs netdata and check its local API and pulse collector, then retry self-host setup netdata. Do not disable authentication or add host access for Homarr.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return VerifyHomarr(ctx, h)
}

func (App) Links() []app.Link { return nil }
