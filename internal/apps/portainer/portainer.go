// Package portainer is Portainer CE: a private container-management UI. The
// owner-admin is preseeded from a generated password file and no Docker socket
// is mounted, so credential preparation is all this App claims.
package portainer

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Portainer. Traps: docs/catalog/traps/portainer.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "portainer", Name: "Portainer", Category: "Containers",
		Description:   "See and manage your running apps from one web page",
		Image:         "docker.io/portainer/portainer-ce:2.45.1",
		Docs:          "https://docs.portainer.io/start/install-ce/server/docker/linux",
		Port:          9000,
		ContainerPort: 9000,
		WebSockets:    true,
		Service:       "portainer",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// Files writes the shared Admin password to the bootstrap file Portainer
// reads with --admin-password-file at first start.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "admin-bootstrap", Content: secret("ADMIN_PASSWORD") + "\n", Mode: 0o600}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  portainer:
    image: docker.io/portainer/portainer-ce:2.45.1
    command: ["--http-enabled", "--bind", ":9000", "--admin-password-file=/run/secrets/admin-bootstrap"]
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./admin-bootstrap:/run/secrets/admin-bootstrap:ro
    ports:
      - ${BIND_IP}:` + port + `:9000
`
}

// loginWorks authenticates the preseeded administrator and reads back the
// identity through the bearer session.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/auth",
		JSON: map[string]string{"Username": user, "Password": password},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("sign-in returned HTTP %d", resp.Status)
	}
	var login struct {
		JWT string `json:"jwt"`
	}
	if err := resp.Decode(&login); err != nil {
		return false, err
	}
	if login.JWT == "" {
		return false, nil
	}
	me, err := h.HTTP(ctx, helpers.Request{Path: "/api/users/me", Header: map[string]string{"Authorization": "Bearer " + login.JWT}})
	if err != nil {
		return false, err
	}
	if !me.OK() {
		return false, nil
	}
	var account struct {
		ID       int    `json:"Id"`
		Username string `json:"Username"`
	}
	if err := me.Decode(&account); err != nil {
		return false, err
	}
	return account.Username == user, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/"); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		Title: func(*helpers.H, string) string { return "the preseeded administrator signs in" },
		Login: loginWorks,
		Create: func(context.Context, *helpers.H, string, string) error {
			return errors.New("Portainer seeds its administrator from the password file at first start")
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + ", sign in as " + user + " with the password shown by `self-host credentials`, then connect a Docker environment separately."
		},
	}.Admin(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := loginWorks(ctx, h, h.AdminUser(), h.AdminPassword()); !ok {
		return fmt.Errorf("the preseeded Portainer administrator cannot sign in: %v", err)
	}
	return nil
}
