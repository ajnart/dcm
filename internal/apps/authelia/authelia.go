// Package authelia is Authelia: a private deny-first authentication portal
// whose single file user is the shared Admin login.
package authelia

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Authelia. Traps: docs/catalog/traps/authelia.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "authelia", Name: "Authelia", Category: "Identity",
		Description:   "Add a login page with a second security step in front of your other apps",
		Image:         "docker.io/authelia/authelia:4.39.25",
		Docs:          "https://www.authelia.com/integration/deployment/docker/",
		Port:          9091,
		ContainerPort: 9091,
		Service:       "authelia",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "origin",
		Prompt:   "Canonical HTTPS portal origin",
		Help:     "The exact approved HTTPS origin Authelia serves, e.g. https://auth.example.com (TLS and DNS are a separate ingress decision)",
		Required: true,
	}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "session_secret", Length: 64},
		{Name: "storage_key", Length: 64},
		{Name: "reset_secret", Length: 64},
	}
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  authelia:
    image: docker.io/authelia/authelia:4.39.25
    restart: unless-stopped
    command: ["--config", "/config/configuration.yml"]
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      AUTHELIA_SESSION_SECRET: ${AUTHELIA_SESSION_SECRET}
      AUTHELIA_STORAGE_ENCRYPTION_KEY: ${AUTHELIA_STORAGE_KEY}
      AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET: ${AUTHELIA_RESET_SECRET}
    volumes:
      - ./config:/config
    ports:
      - ${BIND_IP}:` + fmt.Sprint(rc.Port) + `:9091
`
}

// originHost returns the hostname of the approved origin, which is also the
// eligible cookie domain for the portal. A missing origin keeps the render
// valid; Setup fails with a precise hint until a real one is provided.
func originHost(rc app.RenderContext) string {
	origin := strings.TrimSpace(rc.Inputs["origin"])
	origin = strings.TrimPrefix(origin, "https://")
	origin = strings.TrimPrefix(origin, "http://")
	if i := strings.IndexAny(origin, "/:"); i >= 0 {
		origin = origin[:i]
	}
	if origin == "" {
		return "auth.example.com"
	}
	return origin
}

func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	host := originHost(rc)
	origin := strings.TrimSpace(rc.Inputs["origin"])
	if origin == "" {
		origin = "https://" + host
	}
	user := secret("ADMIN_USER")
	if user == "" {
		user = "admin"
	}
	hash, err := helpers.HashPassword(helpers.Argon2id, secret("ADMIN_PASSWORD"))
	if err != nil {
		return nil
	}
	configuration := `server:
  address: tcp://0.0.0.0:9091/
log:
  level: info
authentication_backend:
  file:
    path: /config/users_database.yml
access_control:
  default_policy: deny
  rules:
    - domain: ` + fmt.Sprintf("%q", host) + `
      subject: ` + fmt.Sprintf("%q", "user:"+user) + `
      policy: one_factor
session:
  cookies:
    - domain: ` + fmt.Sprintf("%q", host) + `
      authelia_url: ` + fmt.Sprintf("%q", origin) + `
storage:
  local:
    path: /config/db.sqlite3
notifier:
  filesystem:
    filename: /config/notification.txt
`
	users := `users:
  ` + user + `:
    disabled: false
    displayname: Administrator
    password: ` + fmt.Sprintf("%q", hash) + `
    email: ` + fmt.Sprintf("%q", user+"@selfhost.local") + `
    groups: []
`
	return []app.File{
		{Path: "config/configuration.yml", Content: configuration, Keep: true},
		{Path: "config/users_database.yml", Content: users, Mode: 0o600, Keep: true},
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "admin-login", "the Admin login signs in to the portal", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return login(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return login(ctx, h) })
		},
		Hint: "Open " + h.URL + " and sign in with the Admin login (self-host credentials). " +
			"Authelia needs a working approved private DNS/TLS route for its HTTPS origin and a writable user database; read the logs with: self-host logs authelia",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := login(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login cannot sign in to Authelia; open %s with the login from self-host credentials", h.URL)
	}
	return nil
}

func (App) Links() []app.Link { return nil }

// login performs the one-factor login and proves the resulting session with
// /api/state, so a bare HTTP 200 is never accepted as identity.
func login(ctx context.Context, h *helpers.H) (bool, error) {
	origin := strings.TrimSpace(h.Inputs["origin"])
	portal, err := url.Parse(origin)
	if err != nil || portal.Scheme != "https" || portal.Hostname() == "" || portal.User != nil || portal.RawQuery != "" || portal.Fragment != "" || (portal.Path != "" && portal.Path != "/") {
		return false, fmt.Errorf("Authelia requires the saved approved HTTPS portal origin and a trusted private TLS route")
	}
	session := h.Session()
	resp, err := session.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/firstfactor", BaseURL: origin,
		JSON: map[string]any{"username": h.AdminUser(), "password": h.AdminPassword(), "keepMeLoggedIn": false},
	})
	if err != nil {
		return false, fmt.Errorf("Authelia HTTPS portal login requires its approved private DNS/TLS route: %w", err)
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	if session.Cookie("authelia_session") == "" {
		return false, nil
	}
	state, err := session.HTTP(ctx, helpers.Request{Path: "/api/state", BaseURL: origin})
	if err != nil {
		return false, err
	}
	if state.Status != http.StatusOK {
		return false, nil
	}
	var body struct {
		Status string `json:"status"`
		Data   struct {
			Username            string `json:"username"`
			AuthenticationLevel int    `json:"authentication_level"`
			FactorKnowledge     bool   `json:"factor_knowledge"`
		} `json:"data"`
	}
	if err := state.Decode(&body); err != nil {
		return false, err
	}
	return body.Status == "OK" && body.Data.Username == h.AdminUser() &&
		body.Data.AuthenticationLevel == 1 && body.Data.FactorKnowledge, nil
}
