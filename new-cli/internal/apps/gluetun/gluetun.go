// Package gluetun is Gluetun: an OpenVPN client that keeps a kill switch on and
// exposes an authenticated read-only control API on the private gateway bind.
package gluetun

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Gluetun. Traps: docs/catalog/traps/gluetun.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "gluetun", Name: "Gluetun", Category: "Downloads",
		Description:   "Routes your downloaders through a VPN with a kill switch, keeping their real IP hidden",
		Image:         "qmcgaw/gluetun:v3.41.3",
		Docs:          "https://github.com/qdm12/gluetun-wiki",
		Port:          8000,
		ContainerPort: 8000,
		Service:       "gluetun",
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{
		{Key: "provider", Prompt: "VPN provider", Help: "A supported OpenVPN provider: protonvpn or purevpn", Default: "protonvpn", Required: true},
		{Key: "server-country", Prompt: "VPN server country", Help: "One provider-supported country name, e.g. Netherlands", Required: true},
		{Key: "openvpn-user", Prompt: "Provider OpenVPN username", Help: "The OpenVPN username issued by the provider (not your web-account login)", Required: true},
		{Key: "openvpn-password", Prompt: "Provider OpenVPN password", Help: "The OpenVPN password issued by the provider", Required: true},
	}
}

// Secrets declares the read-only control API key: Compose hands the generated
// TOML role file to the container, so the key must exist before first start.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "control_api_key", Length: 64, Hex: true}}
}

func (App) Compose(rc app.RenderContext) string {
	provider := rc.Inputs["provider"]
	if provider == "" {
		provider = "protonvpn"
	}
	country := rc.Inputs["server-country"]
	if country == "" {
		country = "Netherlands"
	}
	port := strconv.Itoa(rc.Port)
	return `services:
  gluetun:
    image: qmcgaw/gluetun:v3.41.3
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      TZ: ${TZ}
      VPN_SERVICE_PROVIDER: ` + provider + `
      VPN_TYPE: openvpn
      SERVER_COUNTRIES: ` + country + `
      OPENVPN_USER: ${GLUETUN_OPENVPN_USER}
      OPENVPN_PASSWORD: ${GLUETUN_OPENVPN_PASSWORD}
      FIREWALL_ENABLED_DISABLING_IT_SHOOTS_YOU_IN_YOUR_FOOT: "on"
      HTTP_CONTROL_SERVER_ADDRESS: ":8000"
      HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH: /run/secrets/control-auth
    volumes:
      - ./config:/gluetun
      - ./control-auth.toml:/run/secrets/control-auth:ro
    ports:
      - ${BIND_IP}:` + port + `:8000
`
}

// Files writes the read-only control role that replaces Gluetun's permissive
// default control routes.
func (App) Files(_ app.RenderContext, secret func(string) string) []app.File {
	content := `[[roles]]
name = "private-readonly"
routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip", "GET /v1/portforward"]
auth = "apikey"
apikey = ` + fmt.Sprintf("%q", secret("control_api_key")) + `
`
	return []app.File{{Path: "control-auth.toml", Content: content, Mode: 0o600}}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Step(ctx, "credentials", "save the provider OpenVPN credentials", helpers.StepSpec{
		Check: func(context.Context) (bool, error) {
			return h.Secret(h.Key("openvpn_user")) != "" && h.Secret(h.Key("openvpn_password")) != "", nil
		},
		Do: func(context.Context) error {
			if h.Inputs["openvpn-user"] == "" || h.Inputs["openvpn-password"] == "" {
				return errors.New("no provider OpenVPN credentials were provided")
			}
			if err := h.SetSecret(h.Key("openvpn_user"), h.Inputs["openvpn-user"]); err != nil {
				return err
			}
			return h.SetSecret(h.Key("openvpn_password"), h.Inputs["openvpn-password"])
		},
		Hint: "Use the OpenVPN username and password issued by your VPN provider (not the web-account login), then run: " +
			"self-host install gluetun --set gluetun.openvpn-user=<user> --set gluetun.openvpn-password=<password>, then restart: self-host start gluetun",
		Credential: h.Key("openvpn_user"),
	}); err != nil {
		return err
	}
	return h.Step(ctx, "control", "the VPN is running behind the authenticated control API", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return controlRunning(ctx, h) },
		Do: func(ctx context.Context) error {
			return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return controlRunning(ctx, h) })
		},
		Hint: "Gluetun is not running yet; confirm the provider, country and OpenVPN credentials, recreate the container " +
			"(self-host start gluetun) and read its logs with: self-host logs gluetun",
		Credential: h.Key("control_api_key"),
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	anon, err := h.HTTP(ctx, helpers.Request{Path: "/v1/vpn/status"})
	if err != nil {
		return err
	}
	if anon.Status != http.StatusUnauthorized {
		return fmt.Errorf("Gluetun control access is not authenticated (HTTP %d); the read-only control role is not applied", anon.Status)
	}
	if ok, err := controlRunning(ctx, h); !ok {
		return fmt.Errorf("the Gluetun control API does not report a running VPN: %v", err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }

// controlRunning authenticates with the saved read-only key and reads status.
func controlRunning(ctx context.Context, h *helpers.H) (bool, error) {
	key := h.Secret(h.Key("control_api_key"))
	if key == "" {
		return false, errors.New("the Gluetun control API key is missing from secrets.env")
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/v1/vpn/status", Header: map[string]string{"X-API-Key": key}})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := resp.Decode(&body); err != nil {
		return false, err
	}
	return body.Status == "running", nil
}
