// Package tracearr is Tracearr: private session analytics for your media
// server, backed by TimescaleDB and Redis. Its first owner is created from a
// reviewed email, and media-server enrollment stays a separate approval.
// Traps: docs/catalog/traps/tracearr.md.
package tracearr

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

const defaultEmail = "admin@selfhost.local"

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "tracearr", Name: "Tracearr", Category: "Media",
		Description:   "See who watches what on your media server, and when",
		Image:         "ghcr.io/connorgallopo/tracearr:latest",
		Docs:          "https://docs.tracearr.com/getting-started/installation",
		Port:          3000,
		ContainerPort: 3000,
		Service:       "tracearr",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{Key: "email", Prompt: "First owner's email", Default: defaultEmail}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "db_password", Length: 48},
		{Name: "jwt_secret", Length: 32, Hex: true},
		{Name: "cookie_secret", Length: 32, Hex: true},
		{Name: "auth_secret", Length: 32, Hex: true},
	}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  tracearr:
    image: ghcr.io/connorgallopo/tracearr:latest
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      REDIS_URL: redis://tracearr-redis:6379
      LOG_LEVEL: info
      TZ: ${TZ}
      CORS_ORIGIN: http://127.0.0.1:` + port + `
      DATABASE_URL: postgresql://tracearr:${TRACEARR_DB_PASSWORD}@tracearr-timescale:5432/tracearr
      JWT_SECRET: ${TRACEARR_JWT_SECRET}
      COOKIE_SECRET: ${TRACEARR_COOKIE_SECRET}
      BETTER_AUTH_SECRET: ${TRACEARR_AUTH_SECRET}
    volumes:
      - ./backups:/data/backup
      - ./images:/data/tracearr/image-cache
    ports:
      - ${BIND_IP}:` + port + `:3000
    depends_on:
      - tracearr-timescale
      - tracearr-redis
  tracearr-timescale:
    image: timescale/timescaledb-ha:pg18.4-ts2.29.1
    # This pinned image defaults to postgres UID 1000. Enter its official
    # root ownership preparation for the bind, then it drops to postgres.
    user: "0:0"
    restart: unless-stopped
    shm_size: 512mb
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
    command:
      - postgres
      - -c
      - timescaledb.license=timescale
      - -c
      - timescaledb.max_tuples_decompressed_per_dml_transaction=100000
      - -c
      - max_locks_per_transaction=4096
      - -c
      - timescaledb.telemetry_level=off
      - -c
      - max_connections=150
    environment:
      POSTGRES_USER: tracearr
      POSTGRES_DB: tracearr
      POSTGRES_PASSWORD: ${TRACEARR_DB_PASSWORD}
    volumes:
      - ./database:/home/postgres/pgdata/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "tracearr"]
      interval: 10s
      timeout: 5s
      start_period: 0s
      retries: 5
  tracearr-redis:
    image: redis:alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - ./redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      start_period: 0s
      retries: 5
`
}

func ownerEmail(h *helpers.H) string {
	if email := h.Inputs["email"]; email != "" {
		return email
	}
	return defaultEmail
}

type authObservation struct {
	attempted                         bool
	loginHTTP, meHTTP                 int
	token, username, email, owner, id bool
	sessionToken, ownerID             string
}

func observeLogin(ctx context.Context, h *helpers.H, user, password string, observed *authObservation) (bool, error) {
	*observed = authObservation{attempted: true}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	login, err := loginAfterRateLimit(ctx, h, user, password, observed)
	if err != nil {
		return false, err
	}
	if login.Status == 401 || login.Status == 403 {
		return false, nil
	}
	if login.Status != 200 {
		return false, fmt.Errorf("Tracearr login returned HTTP %d", login.Status)
	}
	var token struct {
		Token string `json:"token"`
	}
	if err := login.Decode(&token); err != nil {
		return false, err
	}
	observed.token = token.Token != ""
	if token.Token == "" {
		return false, nil
	}
	h.Log.Secret(token.Token)
	resp, err := h.HTTP(ctx, helpers.Request{
		Path:   "/api/v1/auth/me",
		Header: map[string]string{"Authorization": "Bearer " + token.Token},
	})
	if err != nil {
		return false, err
	}
	observed.meHTTP = resp.Status
	if resp.Status == 401 || resp.Status == 403 {
		return false, nil
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Tracearr identity returned HTTP %d", resp.Status)
	}
	var me struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Role     string `json:"role"`
		UserID   string `json:"userId"`
	}
	if err := resp.Decode(&me); err != nil {
		return false, err
	}
	observed.username = me.Username == user
	observed.email = me.Email == ownerEmail(h)
	observed.owner = me.Role == "owner"
	observed.id = me.UserID != ""
	valid := observed.username && observed.email && observed.owner && observed.id
	if valid {
		observed.sessionToken, observed.ownerID = token.Token, me.UserID
	}
	return valid, nil
}

// Better Auth 1.6.33 limits sign-in to three requests per ten seconds and
// returns X-Retry-After in seconds. Bound both waits and requests; never infer
// successful authentication from a rate-limit response.
func loginAfterRateLimit(ctx context.Context, h *helpers.H, user, password string, observed *authObservation) (helpers.Response, error) {
	return h.RetryAfter(ctx, helpers.RateLimit{
		Headers: []string{"X-Retry-After", "Retry-After"},
		Bound:   30 * time.Second,
		Retries: 3,
	}, func(ctx context.Context) (helpers.Response, error) {
		resp, err := h.HTTP(ctx, helpers.Request{
			Method: "POST", Path: "/api/v1/auth/sign-in/username",
			JSON: map[string]string{"username": user, "password": password},
		})
		if err == nil {
			observed.loginHTTP = resp.Status
		}
		return resp, err
	})
}

type setupStatus struct {
	NeedsSetup bool `json:"needsSetup"`
}

func ownerExists(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/v1/setup/status"})
	if err != nil {
		return false, err
	}
	var status setupStatus
	if err := resp.Decode(&status); err != nil {
		return false, err
	}
	return !status.NeedsSetup, nil
}

func createOwner(ctx context.Context, h *helpers.H, user, password string) error {
	_, err := h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/api/v1/auth/sign-up/email",
		JSON: map[string]string{
			"name": "Administrator", "username": user,
			"email": ownerEmail(h), "password": password,
		},
	})
	return err
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	var observed authObservation
	first := firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{Path: "/api/v1/setup/status", Want: []int{200}},
		Exists: func(ctx context.Context, h *helpers.H) (bool, error) {
			if observed.loginHTTP == 429 {
				return false, fmt.Errorf("Tracearr login returned HTTP 429; retry setup after the authentication rate limit clears")
			}
			return ownerExists(ctx, h)
		},
		Create: createOwner,
		Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
			return observeLogin(ctx, h, user, password, &observed)
		},
		Manual: "Open " + h.URL + " and create the first owner as " + ownerEmail(h) + ".",
	}
	err := first.Setup(ctx, h)
	if err == nil {
		return setupHomarrKey(ctx, h, observed.sessionToken, observed.ownerID)
	}
	return errors.Join(err, startupStatus(ctx, h), authStatus(ctx, h, observed))
}

// Keep the failed attempt instead of signing in again: retries can hide a
// rate-limit response. Public setup metadata is the only additional request.
func authStatus(ctx context.Context, h *helpers.H, observed authObservation) error {
	if !observed.attempted {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	local, password, needs := "unknown", "unknown", "unknown"
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/setup/status", NoRedirect: true})
	if err == nil && resp.Status == 200 {
		var status struct {
			NeedsSetup      *bool `json:"needsSetup"`
			HasPasswordAuth *bool `json:"hasPasswordAuth"`
			AuthMethods     struct {
				Local *bool `json:"local"`
			} `json:"authMethods"`
		}
		if resp.Decode(&status) == nil {
			flag := func(value *bool) string {
				if value == nil {
					return "unknown"
				}
				return strconv.FormatBool(*value)
			}
			local, password, needs = flag(status.AuthMethods.Local), flag(status.HasPasswordAuth), flag(status.NeedsSetup)
		}
	}
	return h.Step(ctx, "auth-status", "observe Tracearr failed authentication", helpers.StepSpec{
		Do: func(context.Context) error {
			return fmt.Errorf("Tracearr authentication status: login_http=%d token_present=%t me_http=%d username_match=%t email_match=%t owner_match=%t owner_id_present=%t local_login_enabled=%s has_password_auth=%s needs_setup=%s", observed.loginHTTP, observed.token, observed.meHTTP, observed.username, observed.email, observed.owner, observed.id, local, password, needs)
		},
		Hint: "Open " + h.URL + " and check the reported authentication stage and local-login policy; preserve the existing owner and saved credentials.",
	})
}

// Tracearr 2.6.0 exposes these cached public signals even while its API is
// gated with 503. Report only fixed enums and booleans, never migration error
// text, restore details or the raw health body.
func startupStatus(ctx context.Context, h *helpers.H) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/health"})
	if err != nil || resp.Status != 200 {
		return nil
	}
	var status struct {
		Mode  string `json:"mode"`
		DB    *bool  `json:"db"`
		Redis *bool  `json:"redis"`
		Init  string `json:"initStep"`
	}
	if resp.Decode(&status) != nil || (status.Mode != "maintenance" && status.Mode != "starting") {
		return nil
	}
	phase := "unrecognized"
	switch status.Init {
	case "":
		phase = "none"
	case "migrations", "timescale", "services":
		phase = status.Init
	}
	dependency := func(healthy *bool) string {
		if healthy == nil {
			return "unknown"
		}
		if *healthy {
			return "ready"
		}
		return "unavailable"
	}
	return h.Step(ctx, "startup-status", "observe Tracearr startup status", helpers.StepSpec{
		Do: func(context.Context) error {
			return fmt.Errorf("Tracearr startup status: mode=%s db=%s redis=%s init=%s", status.Mode, dependency(status.DB), dependency(status.Redis), phase)
		},
		Hint: "Check the owned database and Redis health and the reported initialization phase before retrying Tracearr setup.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	var observed authObservation
	err := (firstadmin.FirstAdmin{Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
		return observeLogin(ctx, h, user, password, &observed)
	}}).Check(ctx, h)
	if err == nil {
		if homarrKeyNeeded(h) {
			ok, err := homarrKeyWorks(ctx, h, observed.sessionToken, observed.ownerID)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("Tracearr Homarr credential is missing; run self-host setup tracearr, then self-host setup homarr")
			}
		}
		return nil
	}
	return errors.Join(err, authStatus(ctx, h, observed))
}

func (App) Links() []app.Link { return nil }

func (App) StandaloneGuide() string {
	return "After the first start, create the first owner on the first visit."
}
