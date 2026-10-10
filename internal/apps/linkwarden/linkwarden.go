// Package linkwarden is the Linkwarden bookmark manager: a private archive of
// saved pages backed by PostgreSQL and a Meilisearch index.
package linkwarden

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Linkwarden. Traps: docs/catalog/traps/linkwarden.md.
type App struct{}

const service = "linkwarden"

func (App) Info() app.Info {
	return app.Info{
		ID: "linkwarden", Name: "Linkwarden", Category: "Productivity",
		Description:   "Save, archive and search the links you want to keep",
		Image:         "ghcr.io/linkwarden/linkwarden:v2.16.3",
		Docs:          "https://docs.linkwarden.app/self-hosting/setup",
		Port:          3000,
		ContainerPort: 3000,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "auth_secret", Length: 48},
		{Name: "db_password", Length: 48},
		{Name: "search_key", Length: 48},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  linkwarden:
    image: ghcr.io/linkwarden/linkwarden:v2.16.3
    restart: unless-stopped
    environment:
      MEILI_HOST: http://linkwarden-meilisearch:7700
      NEXT_PUBLIC_DISABLE_REGISTRATION: "false"
      NEXTAUTH_URL: http://${LAN_IP}:` + port + `/api/v1/auth
      NEXTAUTH_SECRET: ${LINKWARDEN_AUTH_SECRET}
      MEILI_MASTER_KEY: ${LINKWARDEN_SEARCH_KEY}
      DATABASE_URL: postgresql://postgres:${LINKWARDEN_DB_PASSWORD}@linkwarden-postgres:5432/postgres
    volumes:
      - ./archives:/data/data
    ports:
      - ${BIND_IP}:` + port + `:3000
    depends_on:
      - linkwarden-postgres
      - linkwarden-meilisearch
  linkwarden-postgres:
    image: docker.io/library/postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${LINKWARDEN_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql/data
  linkwarden-meilisearch:
    image: docker.io/getmeili/meilisearch:v1.13.3
    restart: unless-stopped
    environment:
      MEILI_MASTER_KEY: ${LINKWARDEN_SEARCH_KEY}
    volumes:
      - ./search:/meili_data
`
}

// login signs in through the session endpoint and reads the managed
// administrator back with the returned bearer token.
func login(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/v1/session",
		JSON: map[string]string{"username": user, "password": password},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusBadRequest {
		return false, nil
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("the session endpoint returned HTTP %d", resp.Status)
	}
	var body struct {
		Response struct {
			Token string `json:"token"`
		} `json:"response"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	if body.Response.Token == "" {
		return false, nil
	}
	me, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v1/users/me",
		Header: map[string]string{"Authorization": "Bearer " + body.Response.Token},
	})
	if err != nil {
		return false, err
	}
	if me.Status != http.StatusOK {
		return false, nil
	}
	var identity struct {
		Response struct {
			Username string `json:"username"`
			ID       int    `json:"id"`
		} `json:"response"`
	}
	if err := me.Decode(&identity); err != nil {
		return false, err
	}
	return identity.Response.Username == user && identity.Response.ID == 1, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return firstadmin.FirstAdmin{
		// v2.16.3 has no health route. The protected current-user route proves
		// API routing before signup; Login separately verifies authenticated identity.
		Ready:  firstadmin.Probe{Path: "/api/v1/users/me", Want: []int{http.StatusUnauthorized}, Contains: `"response":"You must be logged in."`},
		Create: create,
		Login:  login,
		Manual: "Linkwarden signs up its first account on the private instance.",
	}.Setup(ctx, h)
}

func create(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/v1/users",
		JSON: map[string]string{"username": user, "password": password},
	}, http.StatusCreated)
	return err
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	return firstadmin.FirstAdmin{Create: create, Login: login}.Check(ctx, h)
}

func (App) Links() []app.Link { return nil }
