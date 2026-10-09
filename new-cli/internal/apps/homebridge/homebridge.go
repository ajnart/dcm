// Package homebridge is Homebridge. Traps: docs/catalog/traps/homebridge.md.
package homebridge

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Homebridge. Traps: docs/catalog/traps/homebridge.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "homebridge", Name: "Homebridge", Category: "Home automation",
		Description:   "Brings HomeKit support to smart home accessories that lack it",
		Image:         "homebridge/homebridge:2026-09-25",
		Docs:          "https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-Docker",
		Port:          8581,
		ContainerPort: 8581,
		Service:       "homebridge",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose disables Avahi and publishes administration on loopback; HomeKit
// discovery needs separate LAN networking approval.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  homebridge:
    image: homebridge/homebridge:2026-09-25
    restart: unless-stopped
    environment:
      ENABLE_AVAHI: "0"
      TZ: ${TZ}
    volumes:
      - ./data:/homebridge
    ports:
      - ${BIND_IP}:` + port + `:8581
`
}

type settings struct {
	Env struct {
		SetupWizardComplete bool `json:"setupWizardComplete"`
	} `json:"env"`
}

func readSettings(ctx context.Context, h *helpers.H) (settings, error) {
	var s settings
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/auth/settings"})
	if err != nil {
		return s, err
	}
	return s, resp.Decode(&s)
}

func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	s, err := readSettings(ctx, h)
	if err != nil {
		return false, err
	}
	return s.Env.SetupWizardComplete, nil
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/setup-wizard/create-first-user",
		JSON: map[string]any{"username": user, "name": "Administrator", "admin": true, "password": password},
	}, http.StatusCreated)
	return err
}

// loginWorks signs in and reads the administrator back; the returned bearer
// token is a short-lived session, so it is never stored as a key.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/auth/login",
		JSON: map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if resp.Status != http.StatusCreated {
		return false, fmt.Errorf("POST /api/auth/login returned HTTP %d", resp.Status)
	}
	var login struct {
		AccessToken string `json:"access_token"`
	}
	if err := resp.Decode(&login); err != nil {
		return false, err
	}
	if login.AccessToken == "" {
		return false, nil
	}
	users, err := h.Expect(ctx, helpers.Request{Path: "/api/users", Header: map[string]string{"Authorization": "Bearer " + login.AccessToken}})
	if err != nil {
		return false, err
	}
	var list []struct {
		Username string `json:"username"`
		Admin    bool   `json:"admin"`
	}
	if err := users.Decode(&list); err != nil {
		return false, err
	}
	for _, u := range list {
		if u.Username == user && u.Admin {
			return true, nil
		}
	}
	return false, nil
}

func firstAdmin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/api/auth/settings"},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "complete the setup wizard and create the administrator with the password from `self-host credentials`",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return firstAdmin().Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Homebridge", h.AdminUser())
	}
	return nil
}
