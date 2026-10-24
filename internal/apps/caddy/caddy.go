// Package caddy is the Caddy web server: a private readiness and read-only
// upstream-stats endpoint, with the writable admin API kept on loopback.
package caddy

import (
	"context"
	"errors"
	"fmt"
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
		Description:   "Give your apps their own web addresses, with the secure padlock set up for you",
		Image:         "caddy:latest",
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
    image: caddy:latest
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

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := probe.Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "statistics", "verify Caddy upstream statistics", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			err := VerifyStatistics(ctx, h)
			return err == nil, err
		},
		Do:   func(ctx context.Context) error { return VerifyStatistics(ctx, h) },
		Hint: "Read self-host logs caddy. Keep the admin API on container loopback; restore only the read-only GET /reverse_proxy/upstreams route in Caddy's saved Caddyfile, then run self-host setup caddy. Do not change Access or publish port 2019.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := probe.Check(ctx, h); err != nil {
		return err
	}
	return VerifyStatistics(ctx, h)
}

func VerifyStatistics(ctx context.Context, h *helpers.H) error {
	response, err := h.HTTP(ctx, helpers.Request{Path: "/reverse_proxy/upstreams", NoRedirect: true})
	if err != nil {
		return err
	}
	if response.Status != 200 {
		return fmt.Errorf("Caddy upstream statistics returned HTTP %d; restore the read-only route and retry self-host setup caddy", response.Status)
	}
	var upstreams []struct {
		Address     string `json:"address"`
		NumRequests *int64 `json:"num_requests"`
		Fails       *int64 `json:"fails"`
	}
	if err := response.Decode(&upstreams); err != nil || upstreams == nil {
		return errors.New("Caddy did not return an upstream statistics array; restore the read-only route and retry self-host setup caddy")
	}
	for _, upstream := range upstreams {
		if upstream.Address == "" || upstream.NumRequests == nil || upstream.Fails == nil || *upstream.NumRequests < 0 || *upstream.Fails < 0 {
			return errors.New("Caddy returned incomplete upstream statistics; retry self-host setup caddy")
		}
	}
	return nil
}

func (App) Links() []app.Link { return nil }
