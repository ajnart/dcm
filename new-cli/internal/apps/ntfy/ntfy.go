// Package ntfy is the ntfy notification server: a private broker whose
// administrator is the Admin login and whose topics deny anonymous access.
package ntfy

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "ntfy", Name: "ntfy", Category: "Communication",
		Description:   "Push notifications to your phone and desktop from scripts and Apps",
		Image:         "binwiederhier/ntfy:latest",
		Docs:          "https://docs.ntfy.sh/install/",
		Port:          2586,
		ContainerPort: 80,
		Service:       "ntfy",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  ntfy:
    image: binwiederhier/ntfy:latest
    command: serve
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      TZ: ${TZ}
      NTFY_BASE_URL: http://${LAN_IP}:` + port + `
      NTFY_CACHE_FILE: /var/lib/ntfy/cache.db
      NTFY_AUTH_FILE: /var/lib/ntfy/user.db
      NTFY_AUTH_DEFAULT_ACCESS: deny-all
      NTFY_ENABLE_LOGIN: "true"
    volumes:
      - ./data:/var/lib/ntfy
    ports:
      - ${BIND_IP}:` + port + `:80
    healthcheck:
      test: ["CMD-SHELL", "wget -q --tries=1 http://localhost:80/v1/health -O - | grep -Eo '\"healthy\"\\s*:\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
`
}

type account struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/v1/account", User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil || resp.Status != 200 {
		return false, err
	}
	var acc account
	if err := resp.Decode(&acc); err != nil {
		return false, err
	}
	return acc.Username == h.AdminUser() && acc.Role == "admin", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/v1/health", 2*time.Minute); err != nil {
		return err
	}
	user := h.AdminUser()
	env := map[string]string{"NTFY_PASSWORD": h.AdminPassword()}
	return h.Step(ctx, "admin-user", "create administrator "+user, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			result, err := h.Exec(ctx, env, "ntfy", "user", "add", "--role=admin", user)
			if err != nil && !strings.Contains(string(result.Stderr), "already exists") {
				return err
			}
			if err == nil {
				return nil
			}
			if _, err := h.Exec(ctx, env, "ntfy", "user", "change-pass", user); err != nil {
				return err
			}
			_, err = h.Exec(ctx, nil, "ntfy", "user", "change-role", user, "admin")
			return err
		},
		Hint:       "Run inside the container: ntfy user add --role=admin " + user + " (password from self-host credentials).",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("administrator %s cannot sign in: %v", h.AdminUser(), err)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/selfhost-probe/json?poll=1"})
	if err != nil {
		return err
	}
	if resp.Status != 401 && resp.Status != 403 {
		return fmt.Errorf("anonymous users can read topics (HTTP %d); NTFY_AUTH_DEFAULT_ACCESS=deny-all is not applied", resp.Status)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
