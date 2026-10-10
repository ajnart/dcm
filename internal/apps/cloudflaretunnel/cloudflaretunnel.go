// Package cloudflaretunnel is Cloudflare Tunnel: a connector that publishes an
// existing Cloudflare-issued tunnel route without exposing any local port.
package cloudflaretunnel

import (
	"context"
	"errors"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Cloudflare Tunnel. Traps: docs/catalog/traps/cloudflare-tunnel.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "cloudflare-tunnel", Name: "Cloudflare Tunnel", Category: "Remote access",
		Description:   "Open your app to the internet safely through Cloudflare, with no router changes",
		Image:         "cloudflare/cloudflared:2026.9.1",
		Docs:          "https://developers.cloudflare.com/tunnel/",
		Port:          0,
		ContainerPort: 0,
		Service:       "cloudflare-tunnel",
		NoWebUI:       true,
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "token",
		Prompt:   "Cloudflare Tunnel connector token",
		Help:     "The tunnel run token, not the API token; self-host cloudflare publish obtains it automatically",
		Required: true,
		Private:  true,
	}}
}

func (App) Compose(app.RenderContext) string {
	return `services:
  cloudflare-tunnel:
    image: cloudflare/cloudflared:2026.9.1
    restart: unless-stopped
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TZ: ${TZ}
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
`
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "token", "save the Cloudflare tunnel token", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Secret(h.Key("token")) != "", nil },
		Do: func(context.Context) error {
			if h.Inputs["token"] == "" {
				return errors.New("no Cloudflare tunnel token was provided")
			}
			return h.SetSecret(h.Key("token"), h.Inputs["token"])
		},
		Hint: "Create or open a named tunnel in the Cloudflare Zero Trust dashboard (Networks > Tunnels), " +
			"copy its connector token, then pass it with: self-host install cloudflare-tunnel --set-file cloudflare-tunnel.token=/path/to/credential",
		Credential: h.Key("token"),
	}); err != nil {
		return err
	}
	return h.Step(ctx, "ready", "the connector reaches the Cloudflare edge", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return ready(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return ready(ctx, h) })
		},
		Hint: "The connector is not connected to the Cloudflare edge; check the token and read the logs with: self-host logs cloudflare-tunnel",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("token")) == "" {
		return errors.New("no Cloudflare tunnel token is saved; provide one with: self-host install cloudflare-tunnel --set-file cloudflare-tunnel.token=/path/to/credential")
	}
	ok, err := ready(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Cloudflare connector is not ready; read its logs with: self-host logs cloudflare-tunnel")
	}
	return nil
}

func (App) Links() []app.Link { return nil }

// ready runs the image's native private readiness probe.
func ready(ctx context.Context, h *helpers.H) (bool, error) {
	result, err := h.Exec(ctx, nil, "cloudflared", "tunnel", "--metrics", "127.0.0.1:2000", "ready")
	if err != nil {
		return false, err
	}
	return result.ExitCode == 0, nil
}
