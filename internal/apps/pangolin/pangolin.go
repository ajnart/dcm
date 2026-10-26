// Package pangolin is Pangolin: a private reverse-proxy dashboard and API for
// reaching self-hosted services, published behind its own Traefik router.
package pangolin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Pangolin. Traps: docs/catalog/traps/pangolin.md.
type App struct{}

func (App) AdminEmail(username string) string {
	if username == "" {
		return ""
	}
	return username + "@selfhost.local"
}

func (App) Info() app.Info {
	return app.Info{
		ID: "pangolin", Name: "Pangolin", Category: "Remote access",
		Description:   "Reach your apps from outside your home by name, behind a login page",
		Image:         "traefik:latest",
		Docs:          "https://docs.pangolin.net/",
		Port:          18086,
		ContainerPort: 8080,
		Service:       "pangolin",
	}
}

// Inputs requires the private HTTPS administrative origin; DNS, TLS and the
// first administrator's shared email stay consistent with the Admin login.
func (App) Inputs() []app.Input {
	return []app.Input{
		{
			Key:      "PANGOLIN_CANONICAL_ORIGIN",
			Prompt:   "Private HTTPS URL for the Pangolin dashboard and API",
			Help:     "The exact https://host reverse-proxied to this router. See https://docs.pangolin.net/",
			Required: true,
		},
		{Key: "PANGOLIN_BASE_DOMAIN", Prompt: "Base domain for resources", Help: "Defaults to the administrative origin's host"},
	}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "server_secret", Length: 32},
		{Name: "setup_token", Length: 32, Hex: true},
	}
}

func origin(rc app.RenderContext) string {
	if value := rc.Inputs["PANGOLIN_CANONICAL_ORIGIN"]; value != "" {
		return value
	}
	return "https://pangolin.example.com"
}

func baseDomain(rc app.RenderContext) string {
	if value := rc.Inputs["PANGOLIN_BASE_DOMAIN"]; value != "" {
		return value
	}
	if parsed, err := url.Parse(origin(rc)); err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	return "pangolin.example.com"
}

func host(origin string) string {
	if parsed, err := url.Parse(origin); err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	return "pangolin.example.com"
}

func (App) Compose(rc app.RenderContext) string {
	return `services:
  pangolin:
    image: traefik:latest
    restart: unless-stopped
    command: ["--entryPoints.web.address=:8080", "--entryPoints.web.forwardedHeaders.insecure=true", "--providers.file.filename=/etc/traefik/dynamic.yml", "--api=false"]
    volumes:
      - ./dynamic.yml:/etc/traefik/dynamic.yml:ro
    depends_on:
      - pangolin-server
    ports:
      - ${BIND_IP}:` + fmt.Sprint(rc.Port) + `:8080
  pangolin-server:
    image: fosrl/pangolin:latest
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      SERVER_SECRET_FILE: /run/secrets/server-secret
      PANGOLIN_SETUP_TOKEN: ${PANGOLIN_SETUP_TOKEN}
    volumes:
      - ./config.yml:/app/config/config.yml:ro
      - ./server-secret:/run/secrets/server-secret:ro
      - ./data:/app/config
`
}

const dynamicConfig = "http:\n" +
	"  routers:\n" +
	"    dashboard:\n" +
	"      rule: \"PathPrefix(`/`)\"\n" +
	"      entryPoints: [web]\n" +
	"      service: dashboard\n" +
	"      priority: 1\n" +
	"    api:\n" +
	"      rule: \"PathPrefix(`/api/v1`)\"\n" +
	"      entryPoints: [web]\n" +
	"      service: api\n" +
	"      priority: 10\n" +
	"  services:\n" +
	"    dashboard:\n" +
	"      loadBalancer:\n" +
	"        servers:\n" +
	"          - url: \"http://pangolin-server:3002\"\n" +
	"    api:\n" +
	"      loadBalancer:\n" +
	"        servers:\n" +
	"          - url: \"http://pangolin-server:3000\"\n"

// Files writes the Traefik router, the server config and its secret file.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	base := origin(rc)
	config := "gerbil:\n" +
		"  start_port: 51820\n" +
		"  base_endpoint: " + host(base) + "\n" +
		"app:\n" +
		"  dashboard_url: \"" + base + "\"\n" +
		"  log_level: \"info\"\n" +
		"  telemetry:\n" +
		"    anonymous_usage: false\n" +
		"domains:\n" +
		"  domain1:\n" +
		"    base_domain: \"" + baseDomain(rc) + "\"\n" +
		"server:\n" +
		"  internal_hostname: \"pangolin-server\"\n" +
		"  secret: \"" + secret("server_secret") + "\"\n" +
		"  cors:\n" +
		"    origins: [\"" + base + "\"]\n" +
		"    methods: [\"GET\", \"POST\", \"PUT\", \"DELETE\", \"PATCH\"]\n" +
		"    allowed_headers: [\"X-CSRF-Token\", \"Content-Type\"]\n" +
		"    credentials: false\n" +
		"traefik:\n" +
		"  site_types: [\"local\"]\n" +
		"  allow_raw_resources: false\n" +
		"flags:\n" +
		"  require_email_verification: false\n" +
		"  disable_signup_without_invite: true\n" +
		"  disable_user_create_org: false\n" +
		"  disable_basic_wireguard_sites: true\n" +
		"  allow_raw_resources: false\n"
	return []app.File{
		{Path: "config.yml", Content: config, Mode: 0600},
		{Path: "dynamic.yml", Content: dynamicConfig},
		{Path: "server-secret", Content: secret("server_secret"), Mode: 0600},
	}
}

const managementHint = "Set the external URL with: self-host install pangolin --yes --set pangolin.PANGOLIN_CANONICAL_ORIGIN=https://pangolin.example.com " +
	"(see https://docs.pangolin.net/)"

func adminEmail(h *helpers.H) string { return (App{}).AdminEmail(h.AdminUser()) }

var setupTokenPattern = regexp.MustCompile(`^[a-z0-9]{32}$`)

type loginResult struct {
	Status  int    `json:"status"`
	Success bool   `json:"success"`
	Data    any    `json:"data"`
	Message string `json:"message"`
}

func loginWorks(ctx context.Context, h *helpers.H, email string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/api/v1/auth/login",
		Header: map[string]string{"X-CSRF-Token": "x-csrf-protection"},
		JSON:   map[string]string{"email": email, "password": h.AdminPassword()},
	})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var result loginResult
	if err := resp.Decode(&result); err != nil {
		return false, err
	}
	return result.Success && result.Status == http.StatusOK, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	base := h.Inputs["PANGOLIN_CANONICAL_ORIGIN"]
	email := adminEmail(h)
	if err := h.Step(ctx, "management-url", "the external URL is set", helpers.StepSpec{
		Check: func(context.Context) (bool, error) {
			return strings.HasPrefix(base, "https://"), nil
		},
		Hint: managementHint,
	}); err != nil {
		return err
	}
	secretPath := "Project secrets.env"
	if h.Dir != "" {
		secretPath = filepath.Join(h.Dir, "..", "..", "secrets.env")
	}
	if err := h.Step(ctx, "setup-token", "validate the saved Pangolin bootstrap token", helpers.StepSpec{
		Check: func(context.Context) (bool, error) {
			if !setupTokenPattern.MatchString(h.Secret(h.Key("setup_token"))) {
				return false, errors.New("the saved bootstrap token does not match Pangolin's pinned startup contract")
			}
			return true, nil
		},
		Hint: "Privately replace only " + h.Key("setup_token") + " in " + secretPath +
			" with a securely generated token of exactly 32 lowercase alphanumeric characters. " +
			"Leave ADMIN_USER, ADMIN_PASSWORD, all other credentials and existing data unchanged; then rerun self-host install pangolin.",
	}); err != nil {
		return err
	}
	if err := h.Ready(ctx, "/api/v1/auth/initial-setup-complete", helpers.WantStatus(http.StatusOK), helpers.Contains(`"success"`)); err != nil {
		return err
	}
	return firstadmin.FirstAdmin{
		Username: func(context.Context, *helpers.H) (string, error) { return email, nil },
		Title:    func(_ *helpers.H, user string) string { return "create the first Pangolin administrator " + user },
		Login: func(ctx context.Context, h *helpers.H, user, _ string) (bool, error) {
			return loginWorks(ctx, h, user)
		},
		Create: func(ctx context.Context, h *helpers.H, _, _ string) error {
			resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/v1/auth/initial-setup-complete"})
			if err != nil {
				return err
			}
			var setup loginResult
			if err := resp.Decode(&setup); err != nil {
				return err
			}
			complete := false
			if data, ok := setup.Data.(map[string]any); ok {
				complete, _ = data["complete"].(bool)
			}
			if complete {
				return errors.New("an administrator already exists and the saved Admin login does not sign in")
			}
			created, err := h.Expect(ctx, helpers.Request{
				Method: http.MethodPut, Path: "/api/v1/auth/set-server-admin",
				Header: map[string]string{"X-CSRF-Token": "x-csrf-protection"},
				JSON: map[string]string{"email": email, "password": h.AdminPassword(),
					"setupToken": h.Secret(h.Key("setup_token"))},
			})
			if err != nil {
				return err
			}
			var result loginResult
			if err := created.Decode(&result); err != nil {
				return err
			}
			if !result.Success {
				return errors.New("Pangolin rejected the first administrator creation")
			}
			return nil
		},
		Hint: func(*helpers.H, string) string {
			return "If the first administrator was already created, privately reconcile the saved Admin login with that administrator; preserve its data and do not replay creation. " + managementHint
		},
	}.Admin(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	email := adminEmail(h)
	ok, err := loginWorks(ctx, h, email)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Pangolin administrator %s cannot sign in", email)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
