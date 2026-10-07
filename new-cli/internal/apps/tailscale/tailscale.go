// Package tailscale is the Tailscale userspace connector.
// Traps: docs/catalog/traps/tailscale.md.
package tailscale

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "tailscale", Name: "Tailscale", Category: "Remote access",
		Description:   "Joins this host to your tailnet so its services are reachable privately from anywhere.",
		Image:         "ghcr.io/tailscale/tailscale:v1.102.4",
		Docs:          "https://tailscale.com/docs/",
		Port:          0,
		ContainerPort: 0,
		Service:       "tailscale",
	}
}

// Inputs requires an owner-issued auth key; enrollment cannot be generated locally.
func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "auth_key",
		Prompt:   "Tailscale auth key",
		Help:     "Create an auth key at https://login.tailscale.com/admin/settings/keys and paste it here.",
		Required: true,
	}}
}

// Files writes the auth key; Tailscale reads it as TS_AUTHKEY=file:/run/secrets/auth-key.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "auth-key", Content: rc.Inputs["auth_key"], Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  tailscale:
    image: ghcr.io/tailscale/tailscale:v1.102.4
    entrypoint: ["/usr/local/bin/tailscaled"]
    command: ["--tun=userspace-networking", "--state=/var/lib/tailscale/tailscaled.state", "--socket=/tmp/tailscaled.sock"]
    restart: unless-stopped
    environment:
      TS_AUTHKEY: file:/run/secrets/auth-key
    volumes:
      - ./state:/var/lib/tailscale
      - ./auth-key:/run/secrets/auth-key:ro
`
}

func running(ctx context.Context, h *helpers.H) (bool, error) {
	result, err := h.Exec(ctx, nil, "tailscale", "status", "--json")
	if err != nil {
		return false, err
	}
	var status struct {
		BackendState string `json:"BackendState"`
	}
	if err := json.Unmarshal(result.Stdout, &status); err != nil {
		return false, nil
	}
	return status.BackendState == "Running", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "auth-key", "read the Tailscale auth key", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return h.Inputs["auth_key"] != "", nil },
		Do:    func(context.Context) error { return errors.New("no Tailscale auth key was supplied") },
		Hint: "Create an auth key at https://login.tailscale.com/admin/settings/keys and pass it with " +
			"--set tailscale.auth_key=KEY, then run: self-host install tailscale",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "enroll", "enroll this node in the tailnet", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return running(ctx, h) },
		Do: func(ctx context.Context) error {
			_, err := h.Exec(ctx, nil, "tailscale", "up", "--auth-key=file:/run/secrets/auth-key")
			return err
		},
		Hint: "Enroll by hand inside the container: tailscale up --auth-key=file:/run/secrets/auth-key",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := running(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Tailscale node is not enrolled and running")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
