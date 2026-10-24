// Package mayanedms is Mayan EDMS: an all-in-one document management system
// with PostgreSQL, RabbitMQ and Redis. The first administrator is seeded from
// the Admin login environment, then its initial display is cleared.
// Traps: docs/catalog/traps/mayan-edms.md.
package mayanedms

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "mayan-edms", Name: "Mayan EDMS", Category: "Documents",
		Description:   "Store scanned paper documents, make them searchable and route them for review",
		Image:         "mayanedms/mayanedms:latest",
		Docs:          "https://docs.mayan-edms.com/",
		Port:          8080,
		ContainerPort: 8000,
		Service:       "mayan-edms",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets back PostgreSQL, RabbitMQ and Redis. The Redis password lives in a
// generated config file so it never appears in a command line.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "broker_password", Length: 48},
		{Name: "redis_password", Length: 48},
	}
}

func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{
		{Path: "redis/.keep", Mode: 0o644},
		{Path: "redis-config", Content: "requirepass " + secret("redis_password") + "\n", Mode: 0o600},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  mayan-edms:
    image: mayanedms/mayanedms:latest
    command: ["run_all"]
    restart: unless-stopped
    environment:
      MAYAN_AUTOADMIN_USERNAME: ${ADMIN_USER}
      MAYAN_AUTOADMIN_LOG_CREDENTIALS: "false"
      MAYAN_LOCK_MANAGER_BACKEND: mayan.apps.lock_manager.backends.redis_lock.RedisLock
      MAYAN_SERVER_SIDE_EVENTS_BACKEND: mayan.apps.server_side_events.sse_backends.redis.RedisServerEventStreamBackend
      MAYAN_AUTOADMIN_PASSWORD: ${ADMIN_PASSWORD}
      MAYAN_DATABASES: "{'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'mayan', 'USER': 'mayan', 'PASSWORD': '${MAYAN_EDMS_DB_PASSWORD}', 'HOST': 'mayan-edms-postgresql', 'PORT': '5432'}}"
      MAYAN_CELERY_BROKER_URL: amqp://mayan:${MAYAN_EDMS_BROKER_PASSWORD}@mayan-edms-rabbitmq:5672/mayan
      MAYAN_CELERY_RESULT_BACKEND: redis://:${MAYAN_EDMS_REDIS_PASSWORD}@mayan-edms-redis:6379/1
      MAYAN_LOCK_MANAGER_BACKEND_ARGUMENTS: "{'redis_url': 'redis://:${MAYAN_EDMS_REDIS_PASSWORD}@mayan-edms-redis:6379/2'}"
      MAYAN_SERVER_SIDE_EVENTS_BACKEND_ARGUMENTS: "{'url': 'redis://:${MAYAN_EDMS_REDIS_PASSWORD}@mayan-edms-redis:6379/3'}"
    volumes:
      - ./data:/var/lib/mayan
    ports:
      - ${BIND_IP}:` + port + `:8000
    depends_on:
      mayan-edms-postgresql:
        condition: service_healthy
      mayan-edms-rabbitmq:
        condition: service_healthy
      mayan-edms-redis:
        condition: service_healthy
  mayan-edms-postgresql:
    image: postgres:15.17
    restart: unless-stopped
    environment:
      POSTGRES_DB: mayan
      POSTGRES_USER: mayan
      POSTGRES_PASSWORD: ${MAYAN_EDMS_DB_PASSWORD}
    volumes:
      - ./database:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "--dbname", "mayan", "--username", "mayan"]
      interval: 10s
      timeout: 5s
      start_period: 30s
      retries: 5
  mayan-edms-rabbitmq:
    image: rabbitmq:4.1.8-management
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: mayan
      RABBITMQ_DEFAULT_VHOST: mayan
      RABBITMQ_DEFAULT_PASS: ${MAYAN_EDMS_BROKER_PASSWORD}
    volumes:
      - ./broker:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 30s
      timeout: 30s
      start_period: 20s
      retries: 5
  mayan-edms-redis:
    image: redis:latest
    user: ${PUID}:${PGID}
    entrypoint: ["sh", "-c", "umask 0077; exec redis-server \"$$@\"", "selfhost-redis"]
    command: ["/run/secrets/redis-config"]
    restart: unless-stopped
    environment:
      REDISCLI_AUTH: ${MAYAN_EDMS_REDIS_PASSWORD}
    volumes:
      - ./redis:/data
      - ./redis-config:/run/secrets/redis-config:ro
    healthcheck:
      test: ["CMD", "redis-cli", "-e", "ping"]
      interval: 5s
      timeout: 5s
      start_period: 10s
      retries: 5
`
}

const (
	currentUserPath = "/api/v4/users/current/"
	loginPagePath   = "/authentication/login/"
)

type currentUser struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	IsActive bool   `json:"is_active"`
}

func identity(ctx context.Context, h *helpers.H) (currentUser, bool, error) {
	password := h.AdminPassword()
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:     currentUserPath,
		User:     h.AdminUser(),
		Password: password,
		Header:   map[string]string{"Accept": "application/json"},
	})
	if err != nil {
		return currentUser{}, false, err
	}
	if resp.Status == 401 || resp.Status == 403 {
		return currentUser{}, false, nil
	}
	if resp.Status != 200 {
		return currentUser{}, false, fmt.Errorf("Mayan %s returned HTTP %d", currentUserPath, resp.Status)
	}
	var user currentUser
	if err := resp.Decode(&user); err != nil {
		return currentUser{}, false, err
	}
	ok := user.Username == h.AdminUser() && user.IsActive && user.ID > 0
	return user, ok, nil
}

// visible reports whether the login page still renders the initial password.
func visible(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: loginPagePath})
	if err != nil {
		return false, err
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Mayan %s returned HTTP %d", loginPagePath, resp.Status)
	}
	return strings.Contains(string(resp.Body), h.AdminPassword()), nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	ready := firstadmin.NoAccount{Probe: firstadmin.Probe{Path: "/", Want: []int{200, 302}, Timeout: 5 * time.Minute}}
	if err := ready.Setup(ctx, h); err != nil {
		return err
	}
	login := func(ctx context.Context) (bool, error) {
		_, ok, err := identity(ctx, h)
		return ok, err
	}
	if err := (firstadmin.FirstAdmin{
		StepID: "admin-login",
		Title:  func(_ *helpers.H, user string) string { return "administrator " + user + " signs in" },
		Login:  func(ctx context.Context, _ *helpers.H, _, _ string) (bool, error) { return login(ctx) },
		Create: func(ctx context.Context, h *helpers.H, _, _ string) error {
			return h.Poll(ctx, 5*time.Minute, login)
		},
		Hint: func(h *helpers.H, user string) string {
			return "Open " + h.URL + " and sign in as " + user + " with the password shown by `self-host credentials`."
		},
	}).Admin(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "clear-display", "the login page no longer shows the initial password", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			shown, err := visible(ctx, h)
			return !shown, err
		},
		Do: func(ctx context.Context) error {
			shown, err := visible(ctx, h)
			if err != nil {
				return err
			}
			if !shown {
				return nil
			}
			_, err = h.Expect(ctx, helpers.Request{
				Method: "PATCH", Path: currentUserPath,
				JSON: map[string]string{"password": h.AdminPassword()},
				User: h.AdminUser(), Password: h.AdminPassword(),
			})
			return err
		},
		Hint: "Open " + h.URL + loginPagePath + " and change the administrator password, then run: self-host setup mayan-edms",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	_, ok, err := identity(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the administrator %s cannot sign in to Mayan EDMS", h.AdminUser())
	}
	shown, err := visible(ctx, h)
	if err != nil {
		return err
	}
	if shown {
		return fmt.Errorf("Mayan EDMS still shows its initial administrator password on the login page")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
