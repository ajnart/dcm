// Package bookstack is the BookStack wiki: a private documentation site with
// a MariaDB database.
package bookstack

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is BookStack. Traps: docs/catalog/traps/bookstack.md.
type App struct{}

const (
	service = "bookstack"
	email   = "admin@example.test"
)

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

var csrfPattern = regexp.MustCompile(`name="_token"[^>]*value="([A-Za-z0-9]+)"`)

type jar map[string]string

func (j jar) add(resp helpers.Response) {
	for _, line := range resp.Header.Values("Set-Cookie") {
		pair, _, _ := strings.Cut(line, ";")
		name, value, ok := strings.Cut(pair, "=")
		if ok && name != "" {
			j[name] = value
		}
	}
}

func (j jar) header() string {
	parts := make([]string, 0, len(j))
	for name, value := range j {
		parts = append(parts, name+"="+value)
	}
	return strings.Join(parts, "; ")
}

// login signs in through the pinned email form and proves administrator access
// by opening the users settings page.
func login(ctx context.Context, h *helpers.H) (bool, error) {
	page, err := h.HTTP(ctx, helpers.Request{Path: "/login", Header: map[string]string{"Accept": "text/html"}})
	if err != nil {
		return false, err
	}
	cookies := jar{}
	cookies.add(page)
	if page.Status != http.StatusOK {
		return false, nil
	}
	match := csrfPattern.FindSubmatch(page.Body)
	if match == nil {
		return false, nil
	}
	form := url.Values{"_token": {string(match[1])}, "email": {email}, "password": {h.AdminPassword()}}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/login", Form: form, NoRedirect: true,
		Header: map[string]string{"Accept": "text/html", "Cookie": cookies.header()},
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
	cookies.add(resp)
	users, err := h.HTTP(ctx, helpers.Request{
		Path: "/settings/users", NoRedirect: true,
		Header: map[string]string{"Accept": "text/html", "Cookie": cookies.header()},
	})
	if err != nil {
		return false, err
	}
	return users.Status == http.StatusOK, nil
}

// createAdmin replaces the seeded account with the saved email administrator,
// capturing the generated password before anything else runs.
func createAdmin(ctx context.Context, h *helpers.H) error {
	result, err := h.Exec(ctx, nil,
		"php", "/app/www/artisan", "bookstack:create-admin",
		"--initial", "--email="+email, "--name=Administrator", "--generate-password")
	if err != nil {
		return err
	}
	password := strings.TrimSpace(string(result.Stdout))
	if password == "" {
		return errors.New("bookstack:create-admin returned no password")
	}
	return h.SetSecret("ADMIN_PASSWORD", password)
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/login", 2*time.Minute); err != nil {
		return err
	}
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
		Hint: "Open " + h.URL + "/login, or replace the seeded account inside the container with: " +
			"php /app/www/artisan bookstack:create-admin --initial --email=" + email +
			" --name=Administrator --generate-password",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in", email)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
