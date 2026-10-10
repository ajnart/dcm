// Package ntfy is the ntfy notification server: a private broker whose
// administrator is the Admin login and whose topics deny anonymous access.
package ntfy

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "ntfy", Name: "ntfy", Category: "Communication",
		Description:   "Get instant pop-up alerts on your phone from your apps and scripts",
		Image:         "binwiederhier/ntfy:latest",
		Docs:          "https://docs.ntfy.sh/install/",
		Port:          2586,
		ContainerPort: 80,
		Service:       "ntfy",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the topic Homarr publishes to and subscribes from. The name
// is generated because deny-all only protects a topic whose name is unguessable.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "topic", Length: 32}}
}

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

// homarrToken is the access token ntfy issued for Homarr, or "".
func homarrToken(h *helpers.H) string { return h.Secret(h.Key("homarr_token")) }

type issuedToken struct {
	Token string `json:"token"`
}

// tokenReadsTopic subscribes to the topic with the token. An admin token
// inherits the Admin user's read-write access to every topic.
func tokenReadsTopic(ctx context.Context, h *helpers.H, token, topic string) (bool, error) {
	if token == "" || topic == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:   "/" + topic + "/json?poll=1",
		Header: map[string]string{"Authorization": "Bearer " + token},
	})
	if err != nil {
		return false, err
	}
	return resp.Status == http.StatusOK, nil
}

// createHomarrToken mints a non-expiring administrator token (POST
// /v1/account/token) and saves it for Homarr.
func createHomarrToken(ctx context.Context, h *helpers.H) error {
	resp, err := h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/v1/account/token",
		User: h.AdminUser(), Password: h.AdminPassword(),
		JSON: map[string]any{"label": "homarr"},
	})
	if err != nil {
		return err
	}
	var issued issuedToken
	if err := resp.Decode(&issued); err != nil {
		return err
	}
	if issued.Token == "" {
		return errors.New("ntfy did not return an access token")
	}
	return h.SetSecret(h.Key("homarr_token"), issued.Token)
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/v1/health"); err != nil {
		return err
	}
	user := h.AdminUser()
	env := map[string]string{"NTFY_PASSWORD": h.AdminPassword()}
	if err := h.Step(ctx, "admin-user", "create administrator "+user, helpers.StepSpec{
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
	}); err != nil {
		return err
	}
	return h.Step(ctx, "topic-token", "grant Homarr read-write on its topic", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			return tokenReadsTopic(ctx, h, homarrToken(h), h.Secret(h.Key("topic")))
		},
		Do: func(ctx context.Context) error { return createHomarrToken(ctx, h) },
		Hint: "Create an ntfy access token for " + user + " and save it in secrets.env as " +
			h.Key("homarr_token") + ".",
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
	ok, err := tokenReadsTopic(ctx, h, homarrToken(h), h.Secret(h.Key("topic")))
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Homarr's ntfy access token cannot read its topic")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
