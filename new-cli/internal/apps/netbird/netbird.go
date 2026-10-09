// Package netbird is NetBird: a self-hosted WireGuard-based overlay network
// whose dashboard and control plane are reached through an external HTTPS URL.
package netbird

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is NetBird. Traps: docs/catalog/traps/netbird.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "netbird", Name: "NetBird", Category: "Remote access",
		Description:   "WireGuard overlay network with a self-hosted control plane and dashboard",
		Image:         "netbirdio/dashboard:v2.94.0",
		Docs:          "https://docs.netbird.io/selfhosted/selfhosted-quickstart",
		Port:          18080,
		ContainerPort: 80,
		Service:       "netbird",
	}
}

// Inputs requires the external HTTPS management URL the control plane and
// dashboard are reached through; DNS and TLS stay separately approved.
func (App) Inputs() []app.Input {
	return []app.Input{{
		Key:      "NETBIRD_CANONICAL_ORIGIN",
		Prompt:   "Public HTTPS URL for the NetBird management API and dashboard",
		Help:     "The exact https://host reverse-proxied to this control plane. See https://docs.netbird.io/selfhosted/selfhosted-quickstart",
		Required: true,
	}}
}

func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{
		{Name: "relay_secret", Length: 32},
		{Name: "session_key", Length: 32},
		{Name: "store_key", Length: 32},
	}
}

func origin(rc app.RenderContext) string {
	if value := rc.Inputs["NETBIRD_CANONICAL_ORIGIN"]; value != "" {
		return value
	}
	return "https://netbird.example.com"
}

func (App) Compose(rc app.RenderContext) string {
	base := origin(rc)
	return `services:
  netbird:
    image: netbirdio/dashboard:v2.94.0
    restart: unless-stopped
    environment:
      TZ: ${TZ}
      NETBIRD_MGMT_API_ENDPOINT: ` + base + `
      NETBIRD_MGMT_GRPC_API_ENDPOINT: ` + base + `
      AUTH_AUDIENCE: netbird-dashboard
      AUTH_CLIENT_ID: netbird-dashboard
      AUTH_AUTHORITY: ` + base + `/oauth2
      USE_AUTH0: "false"
      AUTH_SUPPORTED_SCOPES: "openid profile email groups"
      AUTH_REDIRECT_URI: /nb-auth
      AUTH_SILENT_REDIRECT_URI: /nb-silent-auth
      NGINX_SSL_PORT: "443"
      LETSENCRYPT_DOMAIN: none
    depends_on:
      - netbird-server
    ports:
      - ${BIND_IP}:` + fmt.Sprint(rc.Port) + `:80
  netbird-server:
    image: netbirdio/netbird-server:0.80.0
    restart: unless-stopped
    command: ["--config", "/run/secrets/server-config"]
    environment:
      TZ: ${TZ}
      NB_SETUP_PAT_ENABLED: "true"
    volumes:
      - ./server-config:/run/secrets/server-config:ro
      - ./state:/var/lib/netbird
`
}

// Files writes the control-plane config; its signing and encryption keys are
// declared secrets, supplied through secret() rather than Compose.
func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	base := origin(rc)
	storeKey := secret("store_key")
	// Generated keys are 32 raw bytes; the pinned datastore expects Base64.
	// Preserve existing encoded keys and unsupported values rather than rotate
	// encryption material that may already protect persistent state.
	if len(storeKey) == 32 {
		storeKey = base64.StdEncoding.EncodeToString([]byte(storeKey))
	}
	proxy := rc.Inputs["NETBIRD_TRUSTED_PROXY"]
	if proxy == "" {
		proxy = "127.0.0.1"
	}
	config := "server:\n" +
		"  listenAddress: \":80\"\n" +
		"  exposedAddress: \"" + base + "\"\n" +
		"  stunPorts: [3478]\n" +
		"  metricsPort: 9090\n" +
		"  healthcheckAddress: \":9000\"\n" +
		"  logLevel: \"info\"\n" +
		"  logFile: \"console\"\n" +
		"  dataDir: \"/var/lib/netbird\"\n" +
		"  authSecret: " + secret("relay_secret") + "\n" +
		"  auth:\n" +
		"    issuer: \"" + base + "/oauth2\"\n" +
		"    signKeyRefreshEnabled: true\n" +
		"    sessionCookieEncryptionKey: " + secret("session_key") + "\n" +
		"    dashboardRedirectURIs:\n" +
		"      - \"" + base + "/nb-auth\"\n" +
		"      - \"" + base + "/nb-silent-auth\"\n" +
		"    cliRedirectURIs: [\"http://localhost:53000/\"]\n" +
		"  reverseProxy:\n" +
		"    trustedHTTPProxies: [\"" + proxy + "/32\"]\n" +
		"    trustedPeers: [\"" + proxy + "/32\"]\n" +
		"  store:\n" +
		"    engine: \"sqlite\"\n" +
		"    encryptionKey: " + storeKey + "\n"
	return []app.File{{Path: "server-config", Content: config, Mode: 0600}}
}

func ownerEmail(h *helpers.H) string { return h.AdminUser() + "@selfhost.local" }

type user struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

func ownerWorks(ctx context.Context, h *helpers.H, email string) (bool, error) {
	token := h.Secret(h.Key("setup_token"))
	if token == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/users/current",
		Header: map[string]string{"Authorization": "Token " + token}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var current user
	if err := resp.Decode(&current); err != nil {
		return false, err
	}
	return current.Role == "owner" && current.Email == email, nil
}

const managementHint = "Set the external management URL with: self-host install netbird --yes --set netbird.NETBIRD_CANONICAL_ORIGIN=https://netbird.example.com " +
	"(see https://docs.netbird.io/selfhosted/selfhosted-quickstart)"

func (App) Setup(ctx context.Context, h *helpers.H) error {
	base := h.Inputs["NETBIRD_CANONICAL_ORIGIN"]
	if err := h.Step(ctx, "management-url", "the external management URL is set", helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return strings.HasPrefix(base, "https://"), nil },
		Hint:  managementHint,
	}); err != nil {
		return err
	}
	// The published port serves the dashboard; /api is routed to the server
	// through the separately configured HTTPS management origin.
	h.BaseURL = base
	if err := h.Ready(ctx, "/api/instance"); err != nil {
		return err
	}
	email := ownerEmail(h)
	return h.Step(ctx, "owner", "create the first NetBird owner "+email, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return ownerWorks(ctx, h, email) },
		Do: func(ctx context.Context) error {
			resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/instance"})
			if err != nil {
				return err
			}
			var instance struct {
				SetupRequired bool `json:"setup_required"`
			}
			if err := resp.Decode(&instance); err != nil {
				return err
			}
			if !instance.SetupRequired {
				return errors.New("an owner already exists and the saved setup token does not sign in")
			}
			created, err := h.HTTP(ctx, helpers.Request{
				Method: http.MethodPost, Path: "/api/setup",
				JSON: map[string]any{"email": email, "password": h.AdminPassword(), "name": email,
					"create_pat": true, "pat_expire_in": 1},
			})
			if err != nil {
				return err
			}
			if !created.OK() {
				return fmt.Errorf("POST /api/setup returned HTTP %d", created.Status)
			}
			var result struct {
				PAT string `json:"personal_access_token"`
			}
			if err := created.Decode(&result); err != nil {
				return err
			}
			if result.PAT == "" {
				return errors.New("the setup response carried no token; inspect before replaying")
			}
			return h.SetSecret(h.Key("setup_token"), result.PAT)
		},
		Hint:       "If the owner was already created, recover its setup token or recreate the control plane; do not replay setup. " + managementHint,
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	base := h.Inputs["NETBIRD_CANONICAL_ORIGIN"]
	if !strings.HasPrefix(base, "https://") {
		return errors.New(managementHint)
	}
	h.BaseURL = base
	ok, err := ownerWorks(ctx, h, ownerEmail(h))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the NetBird owner %s cannot sign in with the saved setup token", ownerEmail(h))
	}
	return nil
}

func (App) Links() []app.Link { return nil }
