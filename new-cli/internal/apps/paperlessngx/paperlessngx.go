// Package paperlessngx is Paperless-ngx: a searchable, OCR'd archive of your
// documents, with PostgreSQL and Valkey. Its administrator is created from the
// generated admin-password file on the first start.
// Traps: docs/catalog/traps/paperless-ngx.md.
package paperlessngx

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "paperless-ngx", Name: "Paperless-ngx", Category: "Documents",
		Description:   "Turns scanned and downloaded documents into a searchable, tagged archive",
		Image:         "ghcr.io/paperless-ngx/paperless-ngx:3.2.1",
		Docs:          "https://docs.paperless-ngx.com/setup/",
		Port:          8000,
		ContainerPort: 8000,
		Service:       "paperless-ngx",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "app_key", Length: 64},
	}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "secrets/db_password", Content: secret("db_password") + "\n", Mode: 0o600},
		{Path: "secrets/app_key", Content: secret("app_key") + "\n", Mode: 0o600},
		{Path: "secrets/admin_password", Content: secret("ADMIN_PASSWORD") + "\n", Mode: 0o600},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  paperless-ngx:
    image: ghcr.io/paperless-ngx/paperless-ngx:3.2.1
    restart: unless-stopped
    environment:
      PAPERLESS_REDIS: redis://paperless-ngx-broker:6379
      PAPERLESS_DBHOST: paperless-ngx-db
      PAPERLESS_DBENGINE: postgresql
      PAPERLESS_ADMIN_USER: ${ADMIN_USER}
      USERMAP_UID: ${PUID}
      USERMAP_GID: ${PGID}
      PAPERLESS_DBPASS_FILE: /run/secrets/db_password
      PAPERLESS_SECRET_KEY_FILE: /run/secrets/app_key
      PAPERLESS_ADMIN_PASSWORD_FILE: /run/secrets/admin_password
    volumes:
      - ./data:/usr/src/paperless/data
      - ./media:/usr/src/paperless/media
      - ./export:/usr/src/paperless/export
      - ./consume:/usr/src/paperless/consume
      - ./secrets/db_password:/run/secrets/db_password:ro
      - ./secrets/app_key:/run/secrets/app_key:ro
      - ./secrets/admin_password:/run/secrets/admin_password:ro
    ports:
      - ${BIND_IP}:` + port + `:8000
    depends_on:
      - paperless-ngx-broker
      - paperless-ngx-db
  paperless-ngx-broker:
    image: valkey/valkey:9-alpine
    restart: unless-stopped
    volumes:
      - ./broker:/data
  paperless-ngx-db:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: paperless
      POSTGRES_USER: paperless
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - ./database:/var/lib/postgresql
      - ./secrets/db_password:/run/secrets/db_password:ro
`
}

const usersPath = "/api/users/?username=admin&page_size=2"

func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:     usersPath,
		User:     h.AdminUser(),
		Password: h.AdminPassword(),
	})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Paperless %s returned HTTP %d", usersPath, resp.Status)
	}
	var users struct {
		Results []struct {
			ID          int    `json:"id"`
			Username    string `json:"username"`
			IsSuperuser bool   `json:"is_superuser"`
			IsActive    bool   `json:"is_active"`
		} `json:"results"`
	}
	if err := resp.Decode(&users); err != nil {
		return false, err
	}
	matches := 0
	for _, u := range users.Results {
		if u.Username == h.AdminUser() && u.IsSuperuser && u.IsActive {
			matches++
		}
	}
	return matches == 1, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	ready := firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/", Want: []int{200, 302}, Timeout: 5 * time.Minute}}
	if err := ready.Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "admin-login", "administrator "+h.AdminUser()+" signs in", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 5*time.Minute, func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) })
		},
		Hint: "Open " + h.URL + " and sign in as " + h.AdminUser() +
			". The password is in the admin-password file; if the first start failed, read: self-host logs paperless-ngx",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := adminWorks(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Paperless-ngx", h.AdminUser())
	}
	return nil
}

func (App) Links() []app.Link { return nil }
