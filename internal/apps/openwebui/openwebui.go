// Package openwebui is Open WebUI, a private chat front end. The first
// administrator is seeded from the Admin email and password on an empty user
// database.
package openwebui

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// adminEmail is the shared Admin login's email form.
func adminEmail(h *helpers.H) string { return (App{}).AdminEmail(h.AdminUser()) }

// App is Open WebUI. Traps: docs/catalog/traps/open-webui.md.
type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + "@selfhost.local"
}

func (App) Info() app.Info {
	return app.Info{
		ID: "open-webui", Name: "Open WebUI", Category: "Local AI",
		Description:   "Chat with AI models running on your own computer, in your browser",
		Image:         "ghcr.io/open-webui/open-webui:v0.11.4",
		Docs:          "https://docs.openwebui.com/getting-started/quick-start/",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "open-webui",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the persistent session key that keeps sign-ins valid across
// restarts.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "secret_key", Length: 64, Hex: true}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:v0.11.4
    restart: unless-stopped
    environment:
      WEBUI_ADMIN_EMAIL: ${ADMIN_USER}@selfhost.local
      WEBUI_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      WEBUI_SECRET_KEY: ${OPEN_WEBUI_SECRET_KEY}
    volumes:
      - ./appdata:/app/backend/data
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

// adminWorks signs in the seeded administrator and checks its role.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/v1/auths/signin", JSON: map[string]string{
		"email": adminEmail(h), "password": h.AdminPassword(),
	}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var account struct {
		Token string `json:"token"`
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := resp.Decode(&account); err != nil {
		return false, err
	}
	return account.Token != "" && account.Email == adminEmail(h) && account.Role == "admin", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/health"); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		StepID:   "admin-login",
		Username: func(_ context.Context, h *helpers.H) (string, error) { return adminEmail(h), nil },
		Title:    func(_ *helpers.H, user string) string { return "verify the administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminWorks(ctx, h)
		},
		Create: func(context.Context, *helpers.H, string, string) error {
			return errors.New("Open WebUI creates the first administrator from WEBUI_ADMIN_EMAIL/WEBUI_ADMIN_PASSWORD only when the user database is empty")
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open WebUI seeds the first administrator only on an empty database. Recreate the container with an empty " +
				"data volume (self-host start open-webui), then open " + h.URL + " and sign in as " + user +
				" with the password from `self-host credentials`."
		},
	}.Admin(ctx, h)
}

// Check verifies the administrator login only; model provider and API-key
// access stay separate acceptance steps.
func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Open WebUI: %v", adminEmail(h), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
