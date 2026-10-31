// Package oxynote is Oxynote, a collaborative documentation workspace. One
// image runs the whole product with its own PostgreSQL.
package oxynote

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/names"
)

// App is Oxynote. Traps: docs/catalog/traps/oxynote.md.
type App struct{}

func (App) AdminEmail(string) string { return email }

const (
	id      = "oxynote"
	service = "oxynote"
	// email and defaultPassword are the admin the image creates on its
	// first start.
	email           = "admin@example.com"
	defaultPassword = "oxynote-admin-1234"
)

func (App) Info() app.Info {
	return app.Info{
		ID: id, Name: "Oxynote", Category: "Productivity",
		Description:   "Write team docs together, with live charts and queries next to the text",
		Image:         "ghcr.io/oxynote/oxynote:latest",
		Docs:          "https://github.com/oxynote/oxynote/blob/main/docker/prod/README.md",
		Port:          8085,
		ContainerPort: 8080,
		WebSockets:    true,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

// publicURL is the one origin Oxynote accepts. It sets its sign-in cookie for
// this host only, so it must be the address people open. lan is the LAN
// address, or ${LAN_IP} in Compose.
func publicURL(settings map[string]string, lan string, port int) string {
	if settings["EASY_NAMES"] == "on" {
		if host, ok := names.Host(id, settings["LAN_IP"]); ok {
			return "http://" + host
		}
	}
	if settings["EXPOSURE"] == "local" {
		lan = "127.0.0.1"
	}
	return "http://" + lan + ":" + strconv.Itoa(port)
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	// the image runs as UID 65532 and Docker creates fresh binds as root.
	return `services:
  oxynote-init:
    image: ghcr.io/oxynote/oxynote:latest
    user: "0:0"
    network_mode: none
    read_only: true
    entrypoint: ["chown", "-R", "65532:65532", "/owned/data"]
    volumes:
      - ./data:/owned/data
  oxynote:
    image: ghcr.io/oxynote/oxynote:latest
    restart: unless-stopped
    depends_on:
      oxynote-init:
        condition: service_completed_successfully
    environment:
      OXYNOTE_PUBLIC_URL: ` + publicURL(rc.Settings, "${LAN_IP}", rc.Port) + `
    volumes:
      - ./data:/oxynote/data
    ports:
      - ${BIND_IP}:` + port + `:8080
    stop_grace_period: 60s
`
}

// signIn reports whether the admin signs in with password. Sign-in allows
// three attempts in ten seconds and answers 429 with X-Retry-After.
func signIn(ctx context.Context, h *helpers.H, session *helpers.Session, password string) (bool, error) {
	resp, err := h.RetryAfter(ctx, helpers.RateLimit{
		Headers: []string{"X-Retry-After"},
		Default: 10 * time.Second,
		Bound:   time.Minute,
		Hint:    "self-host setup oxynote",
	}, func(ctx context.Context) (helpers.Response, error) {
		return session.HTTP(ctx, helpers.Request{
			Method: http.MethodPost, Path: "/auth-realtime/api/auth/sign-in/email",
			JSON: map[string]string{"email": email, "password": password},
		})
	})
	if err != nil {
		return false, err
	}
	switch resp.Status {
	case http.StatusOK:
		return true, nil
	case http.StatusUnauthorized:
		return false, nil
	}
	return false, fmt.Errorf("the sign-in returned HTTP %d", resp.Status)
}

// takeOver signs in with the default password and sets the Admin password.
func takeOver(ctx context.Context, h *helpers.H) error {
	if n := len(h.AdminPassword()); n < 16 || n > 128 {
		return errors.New("Oxynote needs an Admin password of 16 to 128 characters")
	}
	session := h.Session()
	ok, err := signIn(ctx, h, session, defaultPassword)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New(email + " no longer signs in with the default password")
	}
	// a request carrying the session cookie must name a trusted origin.
	_, err = session.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/auth-realtime/api/auth/change-password",
		Header: map[string]string{"Origin": publicURL(h.Settings, h.Settings["LAN_IP"], h.Port)},
		JSON: map[string]any{
			"currentPassword":     defaultPassword,
			"newPassword":         h.AdminPassword(),
			"revokeOtherSessions": true,
		},
	}, http.StatusOK)
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/auth-realtime/api/auth-config", helpers.WantStatus(http.StatusOK)); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "replace the default password of "+email+" with the Admin password", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			return signIn(ctx, h, h.Session(), h.AdminPassword())
		},
		Do: func(ctx context.Context) error { return takeOver(ctx, h) },
		Hint: "Open " + publicURL(h.Settings, h.Settings["LAN_IP"], h.Port) + ", sign in as " + email + " with the password " + defaultPassword +
			" and change it in the account settings to the Admin password shown by `self-host credentials`, then run: self-host setup oxynote",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := signIn(ctx, h, h.Session(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%s cannot sign in with the Admin password", email)
	}
	return nil
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, sign in as " + email + " with the password " + defaultPassword + " and change it in the account settings."
}
