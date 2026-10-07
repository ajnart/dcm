// Package wud is What's Up Docker: a private image-update inventory for a
// separately approved remote Docker endpoint, never the local socket.
package wud

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is What's Up Docker. Traps: docs/catalog/traps/wud.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "wud", Name: "What's Up Docker", Category: "Containers",
		Description:   "Tracks container image updates so you can choose when to upgrade",
		Image:         "getwud/wud:9.1.0",
		Docs:          "https://getwud.app/docs/",
		Port:          18083,
		ContainerPort: 3000,
		Service:       "wud",
	}
}

// Inputs requires the separately approved remote Docker endpoint; the local
// Docker socket is never mounted, because a :ro bind is not an API permission
// boundary (docs/catalog/traps/wud.md).
func (App) Inputs() []app.Input {
	return []app.Input{
		{
			Key:      "WUD_DOCKER_HOST",
			Prompt:   "DNS name of the approved remote Docker TLS endpoint",
			Help:     "A Docker socket proxy or TLS endpoint whose mutating operations are denied. See https://getwud.app/docs/",
			Required: true,
		},
		{Key: "WUD_DOCKER_PORT", Prompt: "Remote Docker TLS port", Default: "2376"},
	}
}

func dockerHost(rc app.RenderContext) string {
	if value := rc.Inputs["WUD_DOCKER_HOST"]; value != "" {
		return value
	}
	return "docker.example.com"
}

func dockerPort(rc app.RenderContext) string {
	if value := rc.Inputs["WUD_DOCKER_PORT"]; value != "" {
		return value
	}
	return "2376"
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  wud:
    image: getwud/wud:9.1.0
    restart: unless-stopped
    read_only: true
    environment:
      TZ: ${TZ}
      WUD_AUTH_ADMIN_USER: ${ADMIN_USER}
      WUD_AUTH_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      WUD_SERVER_FEATURE_DELETE: "false"
      WUD_WATCHER_DOCKER_APPROVED_HOST: ` + dockerHost(rc) + `
      WUD_WATCHER_DOCKER_APPROVED_PORT: "` + dockerPort(rc) + `"
      WUD_WATCHER_DOCKER_APPROVED_WATCHBYDEFAULT: "false"
      WUD_WATCHER_DOCKER_APPROVED_WATCHEVENTS: "false"
    volumes:
      - ./store:/store
    ports:
      - ${BIND_IP}:` + fmt.Sprint(rc.Port) + `:3000
`
}

const setupHint = "Set the approved remote Docker endpoint with: self-host setup wud --set wud.WUD_DOCKER_HOST=docker.example.com " +
	"--set wud.WUD_DOCKER_PORT=2376 (see https://getwud.app/docs/)"

type identity struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	Provider string `json:"provider"`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/auth/user", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var current identity
	if err := resp.Decode(&current); err != nil {
		return false, err
	}
	return current.Username == h.AdminUser() && current.Role == "admin", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	host := h.Inputs["WUD_DOCKER_HOST"]
	if err := h.Step(ctx, "docker-endpoint", "the approved remote Docker endpoint is set", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return host != "", nil },
		Hint:  setupHint,
	}); err != nil {
		return err
	}
	if err := h.Ready(ctx, "/auth/user"); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "the web UI accepts the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("the administrator is seeded from the environment when the container starts")
		},
		Hint:       "Recreate the container so it reads the Admin login from secrets.env: self-host start wud",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the administrator %s cannot sign in: %v", h.AdminUser(), err)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/containers"})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusUnauthorized {
		return fmt.Errorf("anonymous users can read the inventory (HTTP %d)", resp.Status)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
