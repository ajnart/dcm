// Package bookstack is the BookStack wiki: a private documentation site with
// a MariaDB database.
package bookstack

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is BookStack. Traps: docs/catalog/traps/bookstack.md.
type App struct{}

const service = "bookstack"

func (App) Info() app.Info {
	return app.Info{
		ID: "bookstack", Name: "BookStack", Category: "Productivity",
		Description:   "Organize notes and documentation into books, chapters and pages",
		Image:         "lscr.io/linuxserver/bookstack:v26.05.3-ls277",
		Docs:          "https://www.bookstackapp.com/docs/admin/installation/",
		Port:          8080,
		ContainerPort: 80,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "app_key", Length: 32},
		{Name: "db_password", Length: 48},
		{Name: "db_root_password", Length: 48},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  bookstack:
    image: lscr.io/linuxserver/bookstack:v26.05.3-ls277
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      APP_URL: http://${LAN_IP}:` + port + `
      DB_HOST: db
      DB_PORT: "3306"
      DB_USERNAME: bookstack
      DB_DATABASE: bookstack
      DB_PASSWORD: ${BOOKSTACK_DB_PASSWORD}
      APP_KEY: ${BOOKSTACK_APP_KEY}
    volumes:
      - ./config:/config
    ports:
      - ${BIND_IP}:` + port + `:80
    depends_on:
      - db
  db:
    image: docker.io/library/mariadb:12.3.3
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: bookstack
      MARIADB_USER: bookstack
      MARIADB_PASSWORD: ${BOOKSTACK_DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: ${BOOKSTACK_DB_ROOT_PASSWORD}
    volumes:
      - ./database:/var/lib/mysql
`
}

// login signs in through the pinned email form and proves administrator access
// by opening the users settings page.
func login(ctx context.Context, h *helpers.H) (bool, error) {
	email := h.AdminUser() + "@selfhost.local"
	session := h.Session()
	token, err := session.FormToken(ctx, "/login", "_token")
	if err != nil {
		return false, nil
	}
	form := url.Values{"_token": {token}, "email": {email}, "password": {h.AdminPassword()}}
	resp, err := session.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/login", Form: form, NoRedirect: true,
		Header: map[string]string{"Accept": "text/html"},
	})
	if err != nil {
		return false, err
	}
	if resp.Status == http.StatusUnprocessableEntity {
		return false, nil
	}
	if resp.Status != http.StatusFound {
		return false, fmt.Errorf("the login endpoint returned HTTP %d", resp.Status)
	}
	users, err := session.HTTP(ctx, helpers.Request{
		Path: "/settings/users", NoRedirect: true,
		Header: map[string]string{"Accept": "text/html"},
	})
	if err != nil {
		return false, err
	}
	return users.Status == http.StatusOK, nil
}

// createAdmin replaces the seeded account with the shared Admin login, passing
// the password only through the environment so it never reaches the argv.
func createAdmin(ctx context.Context, h *helpers.H) error {
	user := h.AdminUser()
	script := fmt.Sprintf(
		`php /app/www/artisan bookstack:create-admin --initial --email=%s@selfhost.local --name=%s --password="$SELFHOST_PW"`,
		user, user)
	_, err := h.ExecSecret(ctx, map[string]string{"SELFHOST_PW": h.AdminPassword()}, script)
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/login"); err != nil {
		return err
	}
	email := h.AdminUser() + "@selfhost.local"
	return h.Step(ctx, "admin", "create the administrator "+email, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return login(ctx, h) },
		Do: func(ctx context.Context) error {
			if err := createAdmin(ctx, h); err != nil {
				return err
			}
			ok, err := login(ctx, h)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("the administrator was created but cannot sign in")
			}
			return nil
		},
		Hint: "Open " + h.URL + "/login and sign in as " + email +
			" with the password shown by `self-host credentials`, or replace the seeded account inside the container with: " +
			"php /app/www/artisan bookstack:create-admin --initial --email=" + email +
			" --name=" + h.AdminUser() + ` --password="$SELFHOST_PW"`,
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in", h.AdminUser()+"@selfhost.local")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
