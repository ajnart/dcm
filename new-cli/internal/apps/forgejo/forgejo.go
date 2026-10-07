// Package forgejo is Forgejo. Traps: docs/catalog/traps/forgejo.md.
package forgejo

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Forgejo. Traps: docs/catalog/traps/forgejo.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "forgejo", Name: "Forgejo", Category: "Developer tools",
		Description:   "Self-hosted Git service for private repositories, issues and CI",
		Image:         "codeberg.org/forgejo/forgejo:16.0.5",
		Docs:          "https://forgejo.org/docs/latest/admin/installation-docker/",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "forgejo",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:16.0.5
    restart: unless-stopped
    environment:
      FORGEJO__database__DB_TYPE: sqlite3
      FORGEJO__security__INSTALL_LOCK: "true"
      FORGEJO__service__DISABLE_REGISTRATION: "true"
    volumes:
      - ./data:/data
    ports:
      - ${BIND_IP}:` + port + `:3000
`
}

type account struct {
	Login   string `json:"login"`
	IsAdmin bool   `json:"is_admin"`
	Active  bool   `json:"active"`
}

func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/user", User: user, Password: password})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("GET /api/v1/user returned HTTP %d", resp.Status)
	}
	var u account
	if err := resp.Decode(&u); err != nil {
		return false, err
	}
	return u.Login == user && u.IsAdmin && u.Active, nil
}

// adminExists lists the exact database through the shipped Forgejo CLI.
func adminExists(ctx context.Context, h *helpers.H) (bool, error) {
	res, err := h.Exec(ctx, nil, "su-exec", "git", "forgejo", "admin", "user", "list")
	if err != nil {
		return false, err
	}
	lines := strings.Split(strings.TrimSpace(string(res.Stdout)), "\n")
	return len(lines) > 1, nil
}

// createAdmin sets the Admin password through the environment, so it never
// enters the logged command line.
func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	env := map[string]string{"FORGEJO_ADMIN_PASSWORD": password}
	script := `su-exec git forgejo admin user create --username "` + user + `"` +
		` --email "admin@forgejo.local" --admin --must-change-password=false` +
		` --password "$FORGEJO_ADMIN_PASSWORD"`
	res, err := h.ExecSecret(ctx, env, script)
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return fmt.Errorf("forgejo admin user create exited with %d", res.ExitCode)
	}
	return nil
}

func firstAdmin() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/", Want: []int{http.StatusOK, http.StatusFound}},
		Exists: adminExists,
		Create: createAdmin,
		Login:  loginWorks,
		Manual: "open the site administration page and create the first administrator",
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
		return fmt.Errorf("the Admin login %s cannot sign in to Forgejo", h.AdminUser())
	}
	return nil
}
