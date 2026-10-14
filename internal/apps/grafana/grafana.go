// Package grafana is the Grafana dashboarding and alerting server. The
// administrator is seeded by the image on first start from the Admin login.
package grafana

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

// App is Grafana. Traps: docs/catalog/traps/grafana.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "grafana", Name: "Grafana", Category: "Observability",
		Description:   "Turn numbers about your computers and apps into charts and alerts",
		Image:         "grafana/grafana:13.2.2",
		Docs:          "https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "grafana",
	}
}

func (App) Inputs() []app.Input { return nil }

// Compose runs Grafana as the configured owner of its persisted data directory.
// The Admin login is seeded through environment references on first start.
func (App) Files(app.RenderContext, func(string) string) []app.File {
	return []app.File{{Path: "data/.keep", Mode: 0o644}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  grafana:
    image: grafana/grafana:13.2.2
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      GF_SECURITY_ADMIN_USER: ${ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
    volumes:
      - ./data:/var/lib/grafana
    ports:
      - ${BIND_IP}:` + port + `:3000
`
}

type adminUser struct {
	Login          string `json:"login"`
	IsGrafanaAdmin bool   `json:"isGrafanaAdmin"`
	IsDisabled     bool   `json:"isDisabled"`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/user", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("GET /api/user returned HTTP %d", resp.Status)
	}
	var user adminUser
	if err := resp.Decode(&user); err != nil {
		return false, err
	}
	return user.Login == h.AdminUser() && user.IsGrafanaAdmin && !user.IsDisabled, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/api/health"); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		StepID: "admin-login",
		Title:  func(_ *helpers.H, user string) string { return "verify the administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminWorks(ctx, h)
		},
		Create: func(context.Context, *helpers.H, string, string) error {
			return errors.New("Grafana reads GF_SECURITY_ADMIN_USER and GF_SECURITY_ADMIN_PASSWORD only on first start")
		},
		Hint: func(h *helpers.H, _ string) string {
			return "Grafana applies the Admin login on first start. Recreate the container so it reads secrets.env: " +
				"self-host start grafana, then sign in at " + h.URL + " with the password from `self-host credentials`."
		},
	}.Admin(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Grafana: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
