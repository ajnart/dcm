// Package docmost is the Docmost wiki: a private collaborative workspace with
// its own PostgreSQL database and Redis job queue.
package docmost

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Docmost. Traps: docs/catalog/traps/docmost.md.
type App struct{}

const service = "docmost"

func adminEmail(h *helpers.H) string { return h.AdminUser() + "@selfhost.local" }

func (App) Info() app.Info {
	return app.Info{
		ID: "docmost", Name: "Docmost", Category: "Productivity",
		Description:   "Collaborative wiki and documentation workspace for your household",
		Image:         "docker.io/docmost/docmost:0.96.0",
		Docs:          "https://docmost.com/docs/installation",
		Port:          3000,
		ContainerPort: 3000,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "app_secret", Length: 48},
		{Name: "db_password", Length: 48},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  docmost:
    image: docker.io/docmost/docmost:0.96.0
    restart: unless-stopped
    environment:
      REDIS_URL: redis://redis:6379
      APP_URL: http://${LAN_IP}:` + port + `
      APP_SECRET: ${DOCMOST_APP_SECRET}
      DATABASE_URL: postgresql://docmost:${DOCMOST_DB_PASSWORD}@db:5432/docmost
    volumes:
      - ./storage:/app/data/storage
    ports:
      - ${BIND_IP}:` + port + `:3000
    depends_on:
      - db
      - redis
  db:
    image: docker.io/library/postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: docmost
      POSTGRES_USER: docmost
      POSTGRES_PASSWORD: ${DOCMOST_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql
  redis:
    image: docker.io/library/redis:8
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    volumes:
      - ./redis:/data
`
}

// login signs in with the saved owner credentials and reads the owner role
// back through the pinned users/me endpoint.
func login(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/auth/login",
		JSON: map[string]string{"email": adminEmail(h), "password": h.AdminPassword()},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusBadRequest {
		return false, nil
	}
	if resp.Status != http.StatusOK && resp.Status != http.StatusCreated {
		return false, fmt.Errorf("the login endpoint returned HTTP %d", resp.Status)
	}
	cookie := resp.Cookie("authToken")
	if cookie == "" {
		return false, nil
	}
	identity, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/users/me",
		Body:   []byte("{}"),
		Header: map[string]string{"Cookie": "authToken=" + cookie},
	})
	if err != nil {
		return false, err
	}
	if identity.Status != http.StatusOK {
		return false, nil
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			User struct {
				Email string `json:"email"`
				Role  string `json:"role"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := identity.Decode(&envelope); err != nil {
		return false, err
	}
	return envelope.Success && envelope.Data.User.Email == adminEmail(h) && envelope.Data.User.Role == "owner", nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/api/health", 2*time.Minute); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "create the first workspace owner "+adminEmail(h), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return login(ctx, h) },
		Do: func(ctx context.Context) error {
			if _, err := h.Expect(ctx, helpers.Request{
				Method: http.MethodPost, Path: "/api/auth/setup",
				JSON: map[string]string{"name": "Admin", "email": adminEmail(h), "password": h.AdminPassword()},
			}, http.StatusOK, http.StatusCreated); err != nil {
				return err
			}
			ok, err := login(ctx, h)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("the workspace owner was created but cannot sign in")
			}
			return nil
		},
		Hint:       "Open " + h.URL + " and create the first workspace with email " + adminEmail(h) + " and the password shown by `self-host credentials`, then run: self-host setup docmost",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the workspace owner %s cannot sign in", adminEmail(h))
	}
	return nil
}

func (App) Links() []app.Link { return nil }
