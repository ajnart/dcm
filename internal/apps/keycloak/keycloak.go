// Package keycloak is the Keycloak identity server: a loopback-only OpenID
// Connect provider backed by a private PostgreSQL database.
package keycloak

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Keycloak. Traps: docs/catalog/traps/keycloak.md.
type App struct{}

const service = "keycloak"

func (App) Info() app.Info {
	return app.Info{
		ID: "keycloak", Name: "Keycloak", Category: "Identity",
		Description:   "OpenID Connect single sign-on with an administration console",
		Image:         "quay.io/keycloak/keycloak:26.7.4",
		Docs:          "https://www.keycloak.org/server/configuration-production",
		Port:          8080,
		ContainerPort: 8080,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "db_password", Length: 48}}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.7.4
    command: ["start", "--http-enabled=true", "--hostname=localhost", "--db=postgres", "--db-url-host=db", "--db-username=keycloak"]
    restart: unless-stopped
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${ADMIN_USER}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      KC_DB_PASSWORD: ${KEYCLOAK_DB_PASSWORD}
    ports:
      - ${BIND_IP}:` + port + `:8080
    depends_on:
      db:
        condition: service_healthy
  db:
    image: docker.io/library/postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: keycloak
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: ${KEYCLOAK_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "keycloak", "-d", "keycloak"]
      interval: 5s
      timeout: 5s
      start_period: 10s
      retries: 10
`
}

// adminRealm signs in through the admin-cli token flow and reads the master
// realm back with the resulting access token.
func adminRealm(ctx context.Context, h *helpers.H) (bool, error) {
	form := url.Values{
		"client_id":  {"admin-cli"},
		"username":   {h.AdminUser()},
		"password":   {h.AdminPassword()},
		"grant_type": {"password"},
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/realms/master/protocol/openid-connect/token", Form: form,
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("the token endpoint returned HTTP %d", resp.Status)
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := resp.Decode(&token); err != nil {
		return false, err
	}
	if token.AccessToken == "" {
		return false, errors.New("the token endpoint returned no access token")
	}
	realm, err := h.HTTP(ctx, helpers.Request{
		Path:   "/admin/realms/master",
		Header: map[string]string{"Authorization": "Bearer " + token.AccessToken},
	})
	if err != nil {
		return false, err
	}
	if realm.Status != http.StatusOK {
		return false, fmt.Errorf("the master realm returned HTTP %d", realm.Status)
	}
	var body struct {
		Realm string `json:"realm"`
	}
	if err := realm.Decode(&body); err != nil {
		return false, err
	}
	return body.Realm == "master", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/realms/master", 2*time.Minute); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "the Admin login reads the master realm", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminRealm(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("the bootstrap administrator is created only at first start")
		},
		Hint:       "Recreate Keycloak so it reads KC_BOOTSTRAP_ADMIN_PASSWORD from secrets.env: self-host start keycloak",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminRealm(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot read the master realm", h.AdminUser())
	}
	return nil
}

func (App) Links() []app.Link { return nil }
