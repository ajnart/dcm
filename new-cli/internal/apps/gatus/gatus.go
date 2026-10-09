// Package gatus is Gatus, a private health dashboard whose starter config only
// checks Gatus itself and keeps its history in SQLite.
package gatus

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Gatus. Traps: docs/catalog/traps/gatus.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "gatus", Name: "Gatus", Category: "Monitoring",
		Description:   "Health dashboard that runs periodic checks against your services and shows their status",
		Image:         "ghcr.io/twin/gatus:v5.37.0",
		Docs:          "https://github.com/TwiN/gatus/blob/v5.37.0/README.md",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "gatus",
	}
}

func (App) Inputs() []app.Input { return nil }

const config = `storage:
  type: sqlite
  path: /data/gatus.db
endpoints:
  - name: gatus-self
    group: local
    url: http://127.0.0.1:8080/health
    interval: 1m
    conditions:
      - "[STATUS] == 200"
`

func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "config", Content: config}}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  gatus:
    image: ghcr.io/twin/gatus:v5.37.0
    restart: unless-stopped
    volumes:
      - ./config:/config/config.yaml
      - ./data:/data
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:8080
`
}

var probe = firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/health"}}

func (App) Setup(ctx context.Context, h *helpers.H) error { return probe.Setup(ctx, h) }
func (App) Check(ctx context.Context, h *helpers.H) error { return probe.Check(ctx, h) }

func (App) Links() []app.Link { return nil }
