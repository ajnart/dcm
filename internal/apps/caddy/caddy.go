// Package caddy is the Caddy web server: a private readiness and read-only
// upstream-stats endpoint, with the writable admin API kept on loopback.
package caddy

import (
	"context"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Caddy. Traps: docs/catalog/traps/caddy.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "caddy", Name: "Caddy", Category: "Ingress",
		Description:   "Web server and reverse proxy with automatic TLS, used as the single owner of ingress ports",
		Image:         "caddy:2.11.4",
		Docs:          "https://caddyserver.com/docs/",
		Port:          2015,
		ContainerPort: 2015,
		Service:       "caddy",
	}
}

func (App) Inputs() []app.Input { return nil }

const caddyfile = `{
  admin 127.0.0.1:2019
}

http://:2015 {
  @upstreams {
    method GET
    path /reverse_proxy/upstreams
  }
  route {
    respond /health 200
    reverse_proxy @upstreams 127.0.0.1:2019 {
      header_up Host 127.0.0.1:2019
    }
    respond 404
  }
}
`

func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "caddyfile", Content: caddyfile}}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  caddy:
    image: caddy:2.11.4
    restart: unless-stopped
    volumes:
      - ./caddyfile:/etc/caddy/Caddyfile
      - ./data:/data
      - ./config:/config
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:2015
`
}

var probe = firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/health"}}

func (App) Setup(ctx context.Context, h *helpers.H) error { return probe.Setup(ctx, h) }
func (App) Check(ctx context.Context, h *helpers.H) error { return probe.Check(ctx, h) }

func (App) Links() []app.Link { return nil }
