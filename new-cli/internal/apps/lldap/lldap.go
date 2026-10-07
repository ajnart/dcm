// Package lldap is LLDAP: a private user directory with a web administration
// interface and an LDAP endpoint for other Apps.
package lldap

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is LLDAP. Traps: docs/catalog/traps/lldap.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "lldap", Name: "LLDAP", Category: "Identity",
		Description:   "Lightweight user directory that serves LDAP and a simple web admin to Apps on your network",
		Image:         "lldap/lldap:2026-08-28",
		Docs:          "https://github.com/lldap/lldap/blob/main/docs/install.md",
		Port:          17170,
		ContainerPort: 17170,
		Service:       "lldap",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "jwt_secret", Length: 48},
		{Name: "key_seed", Length: 64, Hex: true},
	}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "jwt-secret", Content: secret("jwt_secret"), Mode: 0o600},
		{Path: "key-seed", Content: secret("key_seed"), Mode: 0o600},
	}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  lldap:
    image: lldap/lldap:2026-08-28
    restart: unless-stopped
    environment:
      UID: ${PUID}
      GID: ${PGID}
      LLDAP_LDAP_USER_DN: ${ADMIN_USER}
      LLDAP_LDAP_BASE_DN: dc=example,dc=com
      LLDAP_LDAP_USER_PASS_FILE: /run/secrets/admin-password
      LLDAP_JWT_SECRET_FILE: /run/secrets/jwt-secret
      LLDAP_KEY_SEED_FILE: /run/secrets/key-seed
    volumes:
      - ./data:/data
      - ./jwt-secret:/run/secrets/jwt-secret:ro
      - ./key-seed:/run/secrets/key-seed:ro
    secrets:
      - admin-password
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:17170

secrets:
  admin-password:
    environment: ADMIN_PASSWORD
`
}

func ready(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/"})
	if err != nil {
		return false, err
	}
	return resp.Status < 500, nil
}

type loginResponse struct {
	Token string `json:"token"`
}

type graphQLResponse struct {
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Data struct {
		User struct {
			ID     string `json:"id"`
			Groups []struct {
				DisplayName string `json:"displayName"`
			} `json:"groups"`
		} `json:"user"`
	} `json:"data"`
}

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	login, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/auth/simple/login",
		JSON: map[string]string{"username": h.AdminUser(), "password": h.AdminPassword()},
	})
	if err != nil {
		return false, err
	}
	if login.Status != 200 {
		return false, nil
	}
	var credentials loginResponse
	if err := login.Decode(&credentials); err != nil {
		return false, err
	}
	if credentials.Token == "" {
		return false, nil
	}
	query, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/graphql",
		Header: map[string]string{"Authorization": "Bearer " + credentials.Token},
		JSON:   map[string]string{"query": `{ user(userId: "` + h.AdminUser() + `") { id groups { displayName } } }`},
	})
	if err != nil {
		return false, err
	}
	if query.Status != 200 {
		return false, nil
	}
	var result graphQLResponse
	if err := query.Decode(&result); err != nil {
		return false, err
	}
	if len(result.Errors) > 0 {
		return false, nil
	}
	if result.Data.User.ID != h.AdminUser() {
		return false, nil
	}
	for _, group := range result.Data.User.Groups {
		if group.DisplayName == "lldap_admin" {
			return true, nil
		}
	}
	return false, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "ready", "wait for the LLDAP web server", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return ready(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				return ready(ctx, h)
			})
		},
		Hint: "Check the App's logs (self-host logs lldap) for startup errors.",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "admin-access", "sign in as the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return errors.New("the administrator is only seeded when LLDAP first creates its database")
		},
		Hint: "The LLDAP administrator is seeded from the Admin login on the first start. Recreate the container so it " +
			"picks up the password (show it with: self-host credentials): self-host start lldap",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the administrator " + h.AdminUser() + " cannot sign in to LLDAP")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
