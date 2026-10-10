// Package postgresql is PostgreSQL: a persistent relational database whose
// administrator password is seeded from the Admin login on the first start.
package postgresql

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is PostgreSQL. Traps: docs/catalog/traps/postgresql.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "postgresql", Name: "PostgreSQL", Category: "Databases",
		Description:   "A database where your other apps keep their information",
		Image:         "docker.io/library/postgres:18.6",
		Docs:          "https://www.postgresql.org/docs/current/",
		Port:          5432,
		ContainerPort: 5432,
		Service:       "postgresql",
		NoWebUI:       true,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	return `services:
  postgresql:
    image: docker.io/library/postgres:18.6
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${ADMIN_USER}
      POSTGRES_DB: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/admin-password
    volumes:
      - ./database:/var/lib/postgresql
    secrets:
      - admin-password
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:5432
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "${ADMIN_USER}", "-d", "postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

secrets:
  admin-password:
    environment: ADMIN_PASSWORD
`
}

func pgReady(ctx context.Context, h *helpers.H, user string) (bool, error) {
	result, err := h.Exec(ctx, nil, "pg_isready", "-U", user, "-d", "postgres")
	if err != nil {
		return false, err
	}
	return result.ExitCode == 0, nil
}

func pgAuth(ctx context.Context, h *helpers.H, user string) (bool, error) {
	result, err := h.Exec(ctx,
		map[string]string{"PGPASSWORD": h.AdminPassword(), "PGPASSFILE": "/dev/null"},
		"psql", "-w", "-h", "127.0.0.1", "-U", user, "-d", "postgres", "-tA", "-c", "SELECT current_user")
	if err != nil {
		return false, err
	}
	return result.ExitCode == 0 && strings.TrimSpace(string(result.Stdout)) == user, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	user := h.AdminUser()
	if err := h.Step(ctx, "ready", "wait for PostgreSQL to accept connections", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return pgReady(ctx, h, user) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) {
				return pgReady(ctx, h, user)
			})
		},
		Hint: "Check the App's logs (self-host logs postgresql) for startup errors.",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "admin-auth", "authenticate as "+user+" over TCP", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return pgAuth(ctx, h, user) },
		Do: func(ctx context.Context) error {
			return errors.New("the database already exists with a different password")
		},
		Hint: "The PostgreSQL password is the Admin login, applied only when the database is first created (show it with: " +
			"self-host credentials). To reseed it, remove the database volume and reinstall: self-host remove postgresql --purge",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := pgAuth(ctx, h, h.AdminUser())
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("PostgreSQL did not prove authenticated administrator access")
	}
	return nil
}

func (App) Links() []app.Link { return nil }
