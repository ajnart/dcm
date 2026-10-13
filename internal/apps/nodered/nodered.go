// Package nodered is the Node-RED flow editor and Admin API. Its
// administrator is enabled before the first start through a bcrypt-hashed
// credential in /data/settings.js.
package nodered

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

// App is Node-RED. Traps: docs/catalog/traps/node-red.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "node-red", Name: "Node-RED", Category: "Home automation",
		Description:   "Connect devices and services with simple drag-and-drop automations",
		Image:         "nodered/node-red:5.0.7",
		Docs:          "https://nodered.org/docs/getting-started/docker",
		Port:          1880,
		ContainerPort: 1880,
		WebSockets:    true,
		Service:       "node-red",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  node-red:
    image: nodered/node-red:5.0.7
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      TZ: ${TZ}
      NODE_RED_ADMIN_AUTH_HASH: ${ADMIN_PASSWORD}
    volumes:
      - ./data:/data
      - ./settings:/data/settings.js
    ports:
      - ${BIND_IP}:` + port + `:1880
`
}

// Files writes the editor authentication settings.js with a Go-generated
// bcrypt hash of the shared Admin login. The file is mode 0600 so the hash
// never lands in a world-readable config.
func (App) Files(_ app.RenderContext, secret func(name string) string) []app.File {
	hash, err := helpers.HashPassword(helpers.Bcrypt, secret("ADMIN_PASSWORD"))
	if err != nil {
		return nil
	}
	content := "module.exports = {\n" +
		"  adminAuth: {\n" +
		"    type: 'credentials',\n" +
		"    users: [{ username: '" + secret("ADMIN_USER") + "', password: '" + hash + "', permissions: '*' }]\n" +
		"  }\n" +
		"};\n"
	return []app.File{{Path: "settings", Content: content, Mode: 0o600}}
}

// adminWorks proves editor authentication is enabled, anonymous flow access is
// denied, and the saved password mints an expiring bearer token that can read
// the flows.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	scheme, err := h.HTTP(ctx, helpers.Request{Path: "/auth/login"})
	if err != nil {
		return false, err
	}
	if scheme.Status != http.StatusOK {
		return false, nil
	}
	var login struct {
		Type string `json:"type"`
	}
	if err := scheme.Decode(&login); err != nil {
		return false, err
	}
	if login.Type != "credentials" {
		return false, nil
	}
	anonymous, err := h.HTTP(ctx, helpers.Request{Path: "/flows"})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized && anonymous.Status != http.StatusForbidden {
		return false, nil
	}
	issued, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/auth/token", JSON: map[string]string{
		"client_id": "node-red-admin", "grant_type": "password", "scope": "*",
		"username": h.AdminUser(), "password": h.AdminPassword(),
	}})
	if err != nil {
		return false, err
	}
	if issued.Status != http.StatusOK {
		return false, nil
	}
	var token struct {
		AccessToken string  `json:"access_token"`
		TokenType   string  `json:"token_type"`
		ExpiresIn   float64 `json:"expires_in"`
	}
	if err := issued.Decode(&token); err != nil {
		return false, err
	}
	if token.AccessToken == "" || token.TokenType != "Bearer" || token.ExpiresIn <= 0 {
		return false, nil
	}
	flows, err := h.HTTP(ctx, helpers.Request{Path: "/flows", Header: map[string]string{"Authorization": "Bearer " + token.AccessToken}})
	if err != nil {
		return false, err
	}
	return flows.Status == http.StatusOK, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/auth/login"); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		StepID: "admin-login",
		Title:  func(_ *helpers.H, user string) string { return "verify the administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, _, _ string) (bool, error) {
			return adminWorks(ctx, h)
		},
		Create: func(context.Context, *helpers.H, string, string) error {
			return errors.New("Node-RED reads /data/settings.js at start; the file is generated before the container starts")
		},
		Hint: func(h *helpers.H, user string) string {
			return "Regenerate /data/settings.js and recreate the container: self-host install node-red, then self-host start node-red. " +
				"Sign in at " + h.URL + " as " + user + " with the password from `self-host credentials`."
		},
	}.Admin(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Node-RED: %v", h.AdminUser(), err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
