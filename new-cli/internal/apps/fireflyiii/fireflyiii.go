// Package fireflyiii is the Firefly III personal finance manager: a private
// ledger with its own PostgreSQL database.
package fireflyiii

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

// App is Firefly III. Traps: docs/catalog/traps/firefly-iii.md.
type App struct{}

const service = "firefly-iii"

func adminEmail(h *helpers.H) string { return h.AdminUser() + "@selfhost.local" }

func (App) Info() app.Info {
	return app.Info{
		ID: "firefly-iii", Name: "Firefly III", Category: "Productivity",
		Description:   "Track your income, expenses and budgets in a private ledger",
		Image:         "fireflyiii/core:version-6.7.2",
		Docs:          "https://docs.firefly-iii.org/how-to/firefly-iii/installation/docker/",
		Port:          8080,
		ContainerPort: 8080,
		Service:       service,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "app_key", Length: 32},
		{Name: "db_password", Length: 48},
		{Name: "cron_token", Length: 32},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  firefly-iii:
    image: fireflyiii/core:version-6.7.2
    restart: always
    environment:
      APP_ENV: production
      APP_DEBUG: "false"
      APP_URL: http://${LAN_IP}:` + port + `
      DB_CONNECTION: pgsql
      DB_HOST: db
      DB_PORT: "5432"
      DB_DATABASE: firefly
      DB_USERNAME: firefly
      DB_PASSWORD: ${FIREFLY_III_DB_PASSWORD}
      APP_KEY: ${FIREFLY_III_APP_KEY}
      STATIC_CRON_TOKEN: ${FIREFLY_III_CRON_TOKEN}
      TZ: ${TZ}
    volumes:
      - ./uploads:/var/www/html/storage/upload
    ports:
      - ${BIND_IP}:` + port + `:8080
    depends_on:
      - db
  db:
    image: docker.io/library/postgres:18
    restart: always
    environment:
      POSTGRES_DB: firefly
      POSTGRES_USER: firefly
      POSTGRES_PASSWORD: ${FIREFLY_III_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql
`
}

var csrfPattern = regexp.MustCompile(`name="_token"[^>]*value="([A-Za-z0-9]+)"`)

// jar collects Set-Cookie values so a form flow can send them back.
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

func csrf(body []byte) (string, bool) {
	match := csrfPattern.FindSubmatch(body)
	if match == nil {
		return "", false
	}
	return string(match[1]), true
}

func register(ctx context.Context, h *helpers.H) error {
	page, err := h.HTTP(ctx, helpers.Request{Path: "/register", Header: map[string]string{"Accept": "text/html"}})
	if err != nil {
		return err
	}
	cookies := jar{}
	cookies.add(page)
	if page.Status != http.StatusOK {
		return fmt.Errorf("the registration page returned HTTP %d", page.Status)
	}
	token, found := csrf(page.Body)
	if !found || !strings.Contains(string(page.Body), `name="password_confirmation"`) {
		return errors.New("registration is closed or the first owner already exists")
	}
	form := url.Values{
		"_token":                {token},
		"invite_code":           {""},
		"email":                 {adminEmail(h)},
		"password":              {h.AdminPassword()},
		"password_confirmation": {h.AdminPassword()},
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/register", Form: form, NoRedirect: true,
		Header: map[string]string{"Accept": "text/html", "Cookie": cookies.header()},
	})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusFound {
		return fmt.Errorf("registration returned HTTP %d", resp.Status)
	}
	return nil
}

// login signs in through the pinned web form and proves owner access by
// reopening the owner profile.
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
	token, found := csrf(page.Body)
	if !found {
		return false, nil
	}
	form := url.Values{"_token": {token}, "email": {adminEmail(h)}, "password": {h.AdminPassword()}}
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
	profile, err := h.HTTP(ctx, helpers.Request{
		Path: "/profile/change-email", NoRedirect: true,
		Header: map[string]string{"Accept": "text/html", "Cookie": cookies.header()},
	})
	if err != nil {
		return false, err
	}
	if profile.Status != http.StatusOK {
		return false, nil
	}
	return strings.Contains(string(profile.Body), `value="`+adminEmail(h)+`"`), nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/login", 2*time.Minute); err != nil {
		return err
	}
	return h.Step(ctx, "admin", "register the first owner "+adminEmail(h), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return login(ctx, h) },
		Do: func(ctx context.Context) error {
			if err := register(ctx, h); err != nil {
				return err
			}
			ok, err := login(ctx, h)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("the first owner was registered but cannot sign in")
			}
			return nil
		},
		Hint:       "Open " + h.URL + "/register and create the first owner with email " + adminEmail(h) + " and the password shown by `self-host credentials`, then run: self-host setup firefly-iii",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the owner %s cannot sign in", adminEmail(h))
	}
	return nil
}

func (App) Links() []app.Link { return nil }
