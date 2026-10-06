// Package vaultwarden is the Vaultwarden password manager: one container
// whose admin page is unlocked by a generated token and whose public signups
// are closed. People get an account through an invitation from that page.
package vaultwarden

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "vaultwarden", Name: "Vaultwarden", Category: "Security",
		Description:   "Password manager compatible with the Bitwarden apps and browser extensions",
		Image:         "vaultwarden/server:latest",
		Docs:          "https://github.com/dani-garcia/vaultwarden/wiki",
		Port:          8222,
		ContainerPort: 80,
		Service:       "vaultwarden",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the admin token: Compose hands it to the container as
// ADMIN_TOKEN, so it has to exist before the first start.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "admin_token", Length: 48}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  vaultwarden:
    image: vaultwarden/server:latest
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      TZ: ${TZ}
      DOMAIN: http://${LAN_IP}:` + port + `
      SIGNUPS_ALLOWED: "false"
      ADMIN_TOKEN: ${VAULTWARDEN_ADMIN_TOKEN}
    volumes:
      - ./data:/data
    ports:
      - ${BIND_IP}:` + port + `:80
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
`
}

const sessionCookie = "VW_ADMIN"

var (
	errRejected    = errors.New("the admin page rejected the admin token")
	errRateLimited = errors.New("the admin page is rate-limiting logins (HTTP 429)")
)

// adminCookie signs in to the admin page with the stored token. Vaultwarden
// allows 3 logins per 5 minutes, so the session is remembered for the run:
// Setup and Check together sign in once.
func adminCookie(ctx context.Context, h *helpers.H) (string, error) {
	return h.Remember("admin-cookie", func() (string, error) {
		token := h.Secret(h.Key("admin_token"))
		if token == "" {
			return "", fmt.Errorf("%s is missing from secrets.env", h.Key("admin_token"))
		}
		resp, err := h.HTTP(ctx, helpers.Request{
			Method: http.MethodPost, Path: "/admin",
			Form: url.Values{"token": {token}},
		})
		if err != nil {
			return "", err
		}
		if resp.Status == http.StatusTooManyRequests {
			return "", errRateLimited
		}
		cookie := resp.Cookie(sessionCookie)
		if cookie == "" {
			return "", fmt.Errorf("%w (HTTP %d)", errRejected, resp.Status)
		}
		return sessionCookie + "=" + cookie, nil
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/alive", 2*time.Minute); err != nil {
		return err
	}
	// Sign in once up front so the hint can tell a rate limit from a stale token.
	_, loginErr := adminCookie(ctx, h)
	hint := "The admin token is read from the container environment when it starts. " +
		"Recreate the container so it picks up " + h.Key("admin_token") + " from secrets.env: self-host start vaultwarden"
	if errors.Is(loginErr, errRateLimited) {
		hint = "Vaultwarden limits admin logins to 3 per 5 minutes: wait about 5 minutes and rerun self-host setup vaultwarden"
	}
	err := h.Step(ctx, "admin-access", "admin page accepts the admin token", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return loginErr == nil, nil },
		Do: func(context.Context) error {
			if errors.Is(loginErr, errRateLimited) {
				return loginErr
			}
			return fmt.Errorf("the admin token cannot be changed while the container runs: %w", loginErr)
		},
		Hint:       hint,
		Credential: h.Key("admin_token"),
	})
	if err != nil {
		return err
	}
	h.Info("Signups are closed. To create the first account, open " + h.URL + "/admin, sign in with the admin token " +
		"(show it with: self-host credentials), choose Invite user, then register with that email at " + h.URL + ". " +
		"The web vault needs HTTPS or localhost for browser cryptography: on a LAN, open it through an SSH tunnel " +
		"(ssh -L " + strconv.Itoa(h.Port) + ":localhost:" + strconv.Itoa(h.Port) + " <host>, then http://localhost:" + strconv.Itoa(h.Port) +
		") or put a reverse proxy with TLS in front.")
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	cookie, err := adminCookie(ctx, h)
	if err != nil {
		return fmt.Errorf("admin login failed: %w", err)
	}
	// diagnostics/config is Vaultwarden's JSON dump of the effective settings.
	resp, err := h.Expect(ctx, helpers.Request{Path: "/admin/diagnostics/config", Header: map[string]string{"Cookie": cookie}})
	if err != nil {
		return err
	}
	var config map[string]any
	if err := resp.Decode(&config); err != nil {
		return err
	}
	if allowed, _ := config["signups_allowed"].(bool); allowed {
		return errors.New("signups are open; SIGNUPS_ALLOWED=false is not applied (recreate the container: self-host start vaultwarden)")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
