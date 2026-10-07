// Package adguard is AdGuard Home. Traps: docs/catalog/traps/adguard-home.md.
package adguard

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is AdGuard Home. Traps: docs/catalog/traps/adguard-home.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "adguard-home", Name: "AdGuard Home", Category: "DNS",
		Description:   "Network-wide DNS ad blocking with a private administration UI",
		Image:         "adguard/adguardhome:v0.107.79",
		Docs:          "https://github.com/AdguardTeam/AdGuardHome/wiki/Docker",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "adguard-home",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Compose publishes only the private admin UI; DNS port 53 needs a separate
// owner-approved cutover.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  adguard-home:
    image: adguard/adguardhome:v0.107.79
    restart: unless-stopped
    volumes:
      - ./work:/opt/adguardhome/work
      - ./conf:/opt/adguardhome/conf
    ports:
      - ${BIND_IP}:` + port + `:3000
`
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/status", User: user, Password: password})
	if err != nil {
		return false, err
	}
	return resp.Status == http.StatusOK, nil
}

// adminExists reports whether the fresh first-install form is gone, which
// means an administrator was already configured.
func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/control/install/get_addresses"})
	if err != nil {
		return false, err
	}
	return resp.Status != http.StatusOK, nil
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/control/install/configure",
		JSON: map[string]any{
			"dns":      map[string]any{"ip": "0.0.0.0", "port": 53},
			"web":      map[string]any{"ip": "0.0.0.0", "port": 3000},
			"username": user,
			"password": password,
		},
	})
	return err
}

func firstAdmin() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready: onboard.Probe{
			Path: "/control/install/get_addresses",
			Want: []int{http.StatusOK, http.StatusForbidden, http.StatusNotFound},
		},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Valid: func(_, password string) error {
			if password == "" || strings.ContainsAny(password, "\r\n\x00") {
				return errors.New("the Admin password is not valid for AdGuard Home")
			}
			return nil
		},
		Manual: "the first-run wizard asks for the administrator username and password",
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
		return fmt.Errorf("the Admin login %s cannot sign in to AdGuard Home", h.AdminUser())
	}
	return nil
}
