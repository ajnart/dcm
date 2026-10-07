// Package beszel is the Beszel monitoring hub.
// Traps: docs/catalog/traps/beszel.md.
package beszel

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
		ID: "beszel", Name: "Beszel", Category: "Monitoring",
		Description:   "A lightweight dashboard for the CPU, memory and disk of the machines you monitor.",
		Image:         "henrygd/beszel:0.20.0",
		Docs:          "https://www.beszel.dev/guide/hub-installation",
		Port:          8090,
		ContainerPort: 8090,
		Service:       "beszel",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  beszel:
    image: henrygd/beszel:0.20.0
    restart: unless-stopped
    environment:
      APP_URL: http://${LAN_IP}:` + port + `
    volumes:
      - ./data:/beszel_data
    ports:
      - ${BIND_IP}:` + port + `:8090
`
}

const emailSuffix = "@selfhost.local"

func adminEmail(h *helpers.H) string { return h.AdminUser() + emailSuffix }

func firstRun(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/beszel/first-run"}, http.StatusOK)
	if err != nil {
		return false, err
	}
	var body struct {
		FirstRun bool `json:"firstRun"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.FirstRun, nil
}

func adminSignedIn(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost,
		Path: "/api/collections/users/auth-with-password",
		JSON: map[string]string{"identity": adminEmail(h), "password": h.AdminPassword()}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var body struct {
		Token  string `json:"token"`
		Record struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"record"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.Token != "" && body.Record.Email == adminEmail(h) && body.Record.Role == "admin", nil
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
	if err := ready(ctx, h, "/api/health"); err != nil {
		return err
	}
	user := adminEmail(h)
	return h.Step(ctx, "admin-login", "create the Hub administrator "+user, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminSignedIn(ctx, h) },
		Do: func(ctx context.Context) error {
			pending, err := firstRun(ctx, h)
			if err != nil {
				return err
			}
			if !pending {
				return errors.New("this Hub already has an administrator outside setup")
			}
			_, err = h.Expect(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/beszel/create-user",
				JSON: map[string]string{"email": user, "password": h.AdminPassword()}}, http.StatusOK)
			return err
		},
		Hint: "Open " + h.URL + " and create the administrator " + user +
			" with the password shown by `self-host credentials`, then run: self-host setup beszel",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminSignedIn(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin login cannot sign in to Beszel")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
