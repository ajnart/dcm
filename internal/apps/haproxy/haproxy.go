// Package haproxy is HAProxy: a private HTTP front end with authenticated
// read-only statistics that proxies to one selected application.
package haproxy

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is HAProxy. Traps: docs/catalog/traps/haproxy.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "haproxy", Name: "HAProxy", Category: "Ingress",
		Description:   "Give your apps one shared front door, with a page of usage statistics",
		Image:         "haproxy:latest",
		Docs:          "https://docs.haproxy.org/",
		Port:          18081,
		ContainerPort: 8080,
		Service:       "haproxy",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{
		{Key: "target-app", Prompt: "Backend application", Help: "The catalog App id to proxy to, e.g. ntfy", Required: true},
		{Key: "target-port", Prompt: "Backend container port", Help: "The container port of the selected App, e.g. 80", Required: true},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  haproxy:
    image: haproxy:latest
    restart: unless-stopped
    read_only: true
    environment:
      TZ: ${TZ}
      HAPROXY_ADMIN_USER: ${ADMIN_USER}
      HAPROXY_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

// Files writes the configuration. The statistics password is read from the
// container environment, so only the non-secret config is container-readable.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	_ = secret
	target := rc.Inputs["target-app"]
	if target == "" {
		target = "ntfy"
	}
	targetPort := rc.Inputs["target-port"]
	if targetPort == "" {
		targetPort = "80"
	}
	config := `global
  maxconn 256

defaults
  mode http
  timeout connect 5s
  timeout client 30s
  timeout server 30s

userlist owner-stats
  user "$HAPROXY_ADMIN_USER" insecure-password "$HAPROXY_ADMIN_PASSWORD"

frontend private-http
  bind :8080
  acl owner_stats path -i /_stats
  use_backend owner-stats if owner_stats
  default_backend selected

backend owner-stats
  stats enable
  stats uri /_stats
  stats hide-version
  stats http-request auth realm owner-stats unless { http_auth(owner-stats) }

backend selected
  server app ` + target + `:` + targetPort + ` check
`
	return []app.File{{Path: "haproxy.cfg", Content: config}}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "stats-auth", "statistics deny anonymous access and accept the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return statsOK(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return statsOK(ctx, h) })
		},
		Hint: "Open " + h.URL + "/_stats and sign in as " + h.AdminUser() +
			" (password from self-host credentials); read the logs with: self-host logs haproxy",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := statsOK(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("HAProxy statistics are not protected for the Admin login; open %s/_stats", h.URL)
	}
	return nil
}

func (App) Links() []app.Link { return nil }

func statsOK(ctx context.Context, h *helpers.H) (bool, error) {
	anon, err := h.HTTP(ctx, helpers.Request{Path: "/_stats"})
	if err != nil {
		return false, err
	}
	if anon.Status == http.StatusOK {
		return false, errors.New("statistics answer anonymous visitors")
	}
	authed, err := h.HTTP(ctx, helpers.Request{Path: "/_stats", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	return authed.Status == http.StatusOK, nil
}
