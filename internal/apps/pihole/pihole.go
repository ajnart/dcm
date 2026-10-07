// Package pihole is Pi-hole, a network-wide DNS ad blocker.
// Traps: docs/catalog/traps/pihole.md.
package pihole

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "pihole", Name: "Pi-hole", Category: "DNS",
		Description:   "Blocks ads and trackers for every device on your network with a private admin UI.",
		Image:         "pihole/pihole:2026.09.0",
		Docs:          "https://docs.pi-hole.net/docker/",
		Port:          8080,
		ContainerPort: 80,
		Service:       "pihole",
	}
}

func (App) Inputs() []app.Input { return nil }

// Files writes the Admin password for WEBPASSWORD_FILE; the container reads it
// on first start and never sees the value in Compose or a command line.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "admin-password", Content: secret("ADMIN_PASSWORD"), Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  pihole:
    image: pihole/pihole:2026.09.0
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      WEBPASSWORD_FILE: /run/secrets/admin-password
    volumes:
      - ./config:/etc/pihole
      - ./admin-password:/run/secrets/admin-password:ro
    ports:
      - ${BIND_IP}:53:53/udp
      - ${BIND_IP}:53:53/tcp
      - ${BIND_IP}:` + port + `:80
`
}

func sessionWorks(ctx context.Context, h *helpers.H) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/auth",
		JSON: map[string]string{"password": h.AdminPassword()}})
	if err != nil {
		return false, err
	}
	if login.Status != http.StatusOK {
		return false, nil
	}
	var body struct {
		Session struct {
			Valid bool   `json:"valid"`
			SID   string `json:"sid"`
		} `json:"session"`
	}
	if err := login.Decode(&body); err != nil {
		return false, err
	}
	if !body.Session.Valid || body.Session.SID == "" {
		return false, nil
	}
	version, err := h.HTTP(ctx, helpers.Request{Path: "/api/info/version",
		Header: map[string]string{"X-FTL-SID": body.Session.SID}})
	if err != nil {
		return false, err
	}
	return version.Status == http.StatusOK, nil
}

func ready(ctx context.Context, h *helpers.H, path string) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path})
		if err != nil {
			return false, err
		}
		return resp.Status < 500, nil
	}
	return h.Step(ctx, "ready", "wait for the web server on "+path, helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h, "/admin/"); err != nil {
		return err
	}
	return h.Step(ctx, "admin-login", "authenticate the web password", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return sessionWorks(ctx, h) },
		Hint:       "Recreate the container so it reads the web password file: self-host start pihole",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := sessionWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin password cannot sign in to the Pi-hole web API")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
