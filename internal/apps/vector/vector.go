// Package vector is Vector: a private, self-only telemetry pipeline whose API
// only proves it is initialized and serving, not that logs flow anywhere.
package vector

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Vector. Traps: docs/catalog/traps/vector.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "vector", Name: "Vector", Category: "Observability",
		Description:   "Collect your apps' activity messages and send them where you choose",
		Image:         "ghcr.io/vectordotdev/vector:latest-debian",
		Docs:          "https://vector.dev/docs/setup/installation/platforms/docker/",
		Port:          8686,
		ContainerPort: 8686,
		Service:       "vector",
	}
}

func (App) Inputs() []app.Input { return nil }

const config = `api:
  enabled: true
  address: 0.0.0.0:8686
sources:
  vector_logs:
    type: internal_logs
sinks:
  console:
    type: console
    inputs:
      - vector_logs
    target: stdout
    encoding:
      codec: text
`

func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "config", Content: config}}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  vector:
    image: ghcr.io/vectordotdev/vector:latest-debian
    restart: unless-stopped
    volumes:
      - ./config:/etc/vector/vector.yaml
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:8686
`
}

var probe = firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/health", Contains: `"ok":true`}}

func (App) Setup(ctx context.Context, h *helpers.H) error { return probe.Setup(ctx, h) }
func (App) Check(ctx context.Context, h *helpers.H) error { return probe.Check(ctx, h) }

func (App) Links() []app.Link { return nil }
