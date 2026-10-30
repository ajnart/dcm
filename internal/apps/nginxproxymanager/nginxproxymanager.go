// Package nginxproxymanager is the Nginx Proxy Manager admin UI.
// Traps: docs/catalog/traps/nginx-proxy-manager.md.
package nginxproxymanager

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + emailSuffix
}

func (App) Info() app.Info {
	return app.Info{
		ID: "nginx-proxy-manager", Name: "Nginx Proxy Manager", Category: "Ingress",
		Description:   "Give your apps easy web addresses and secure padlocks from a web page",
		Image:         "jc21/nginx-proxy-manager:latest",
		Docs:          "https://nginxproxymanager.com/guide/",
		Port:          8181,
		ContainerPort: 81,
		Service:       "nginx-proxy-manager",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  nginx-proxy-manager:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    ports:
      - ${BIND_IP}:` + port + `:81
`
}

const emailSuffix = "@selfhost.local"

func adminEmail(h *helpers.H) string { return (App{}).AdminEmail(h.AdminUser()) }

func setupPending(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/"}, http.StatusOK)
	if err != nil {
		return false, err
	}
	var body struct {
		Setup *bool `json:"setup"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, errors.New("Nginx Proxy Manager returned an invalid setup state")
	}
	if body.Setup == nil {
		return false, errors.New("Nginx Proxy Manager did not report its setup state")
	}
	// v2.16.0's setup flag means an active user already exists.
	return !*body.Setup, nil
}

func adminSignedIn(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/tokens",
		JSON: map[string]string{"identity": adminEmail(h), "secret": h.AdminPassword()}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var token struct {
		Token string `json:"token"`
	}
	if err := resp.Decode(&token); err != nil {
		return false, err
	}
	if token.Token == "" {
		return false, nil
	}
	me, err := h.HTTP(ctx, helpers.Request{Path: "/api/users/me",
		Header: map[string]string{"Authorization": "Bearer " + token.Token}})
	if err != nil {
		return false, err
	}
	if me.Status != http.StatusOK {
		return false, nil
	}
	var user struct {
		Email      string   `json:"email"`
		Roles      []string `json:"roles"`
		IsDisabled bool     `json:"is_disabled"`
	}
	if err := me.Decode(&user); err != nil {
		return false, err
	}
	return user.Email == adminEmail(h) && !user.IsDisabled && hasRole(user.Roles, "admin"), nil
}

func hasRole(roles []string, want string) bool {
	for _, role := range roles {
		if role == want {
			return true
		}
	}
	return false
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
	if err := ready(ctx, h, "/api/"); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		StepID:   "admin-login",
		Username: func(_ context.Context, h *helpers.H) (string, error) { return adminEmail(h), nil },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminSignedIn(ctx, h)
		},
		Create: func(ctx context.Context, h *helpers.H, user, _ string) error {
			pending, err := setupPending(ctx, h)
			if err != nil {
				return err
			}
			if !pending {
				return errors.New("this server already has an administrator outside setup")
			}
			_, err = h.Expect(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/users",
				JSON: map[string]any{
					"name":     "Administrator",
					"nickname": "Admin",
					"email":    user,
					"auth":     map[string]string{"type": "password", "secret": h.AdminPassword()},
				}}, http.StatusCreated)
			return err
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + " and create the administrator " + user +
				" with the password shown by `self-host credentials`, then run: self-host setup nginx-proxy-manager"
		},
	}.Admin(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminSignedIn(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the Admin login cannot sign in to Nginx Proxy Manager")
	}
	return nil
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, create the administrator on the first visit."
}
