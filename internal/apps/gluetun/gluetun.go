// Package gluetun is Gluetun: an OpenVPN client that keeps a kill switch on and
// exposes an authenticated read-only control API on the private gateway bind.
package gluetun

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"strconv"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Gluetun. Traps: docs/catalog/traps/gluetun.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "gluetun", Name: "Gluetun", Category: "Downloads",
		Description:   "Send your downloads through a VPN, and stop them if it disconnects",
		Image:         "qmcgaw/gluetun:latest",
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
		{Key: "openvpn-user", Prompt: "Provider OpenVPN username", Help: "The OpenVPN username issued by the provider (not your web-account login)", Required: true, Private: true},
		{Key: "openvpn-password", Prompt: "Provider OpenVPN password", Help: "The OpenVPN password issued by the provider", Required: true, Private: true},
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
    image: qmcgaw/gluetun:latest
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
				return helpers.ErrManual
			}
			if err := h.SetSecret(h.Key("openvpn_user"), h.Inputs["openvpn-user"]); err != nil {
				return err
			}
			return h.SetSecret(h.Key("openvpn_password"), h.Inputs["openvpn-password"])
		},
		Hint: "Use the OpenVPN username and password issued by your VPN provider (not the web-account login), then run: " +
			"self-host install gluetun --set-file gluetun.openvpn-user=/path/to/username --set-file gluetun.openvpn-password=/path/to/password, then restart: self-host start gluetun",
		Credential: h.Key("openvpn_user"),
	}); err != nil {
		return err
	}
	if err := h.Step(ctx, "control", "verify the saved read-only control API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, err := controlStatus(ctx, h)
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			_, err := controlStatus(ctx, h)
			return err
		},
		Hint: "Restore the Project's saved control key if missing. An outdated control-auth.toml needs an approved repeat of " +
			"self-host install gluetun, then self-host start gluetun and self-host setup gluetun. Do not enable anonymous access or VPN control writes.",
		Credential: h.Key("control_api_key"),
	}); err != nil {
		return err
	}
	return h.Step(ctx, "vpn", "verify the VPN is running and reports its public IP", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return controlRunning(ctx, h) },
		Do: func(ctx context.Context) error {
			running, err := controlRunning(ctx, h)
			if err != nil || running {
				return err
			}
			return helpers.ErrManual
		},
		Hint: "The control API answered, but the VPN is not ready. Confirm your provider account, country and privately supplied OpenVPN credentials, " +
			"then self-host start gluetun and self-host setup gluetun. Do not disable the firewall or reroute traffic to finish Setup.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := controlRunning(ctx, h); err != nil {
		return err
	} else if !ok {
		return errors.New("Gluetun has not reported both a running VPN and a public IP; finish the provider Manual step and retry self-host setup gluetun")
	}
	return nil
}

func (App) Links() []app.Link { return nil }

func controlStatus(ctx context.Context, h *helpers.H) (string, error) {
	key := h.Secret(h.Key("control_api_key"))
	if key == "" {
		return "", errors.New("the Gluetun control API key is missing; restore it through the Project's secret boundary and retry self-host setup gluetun")
	}
	anon, err := h.HTTP(ctx, helpers.Request{Path: "/v1/vpn/status", NoRedirect: true})
	if err != nil {
		return "", fmt.Errorf("cannot reach the Gluetun control API; retry self-host setup gluetun: %w", err)
	}
	if anon.Status != http.StatusUnauthorized {
		return "", fmt.Errorf("Gluetun must reject anonymous control access (HTTP %d); restore its read-only role and retry self-host setup gluetun", anon.Status)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/v1/vpn/status", NoRedirect: true, Header: map[string]string{"X-API-Key": key}})
	if err != nil {
		return "", fmt.Errorf("cannot read Gluetun VPN status: %w", err)
	}
	if resp.Status != http.StatusOK {
		return "", fmt.Errorf("Gluetun rejected the saved control request (HTTP %d); repair its read-only key and retry self-host setup gluetun", resp.Status)
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := resp.Decode(&body); err != nil {
		return "", errors.New("Gluetun returned invalid VPN status data")
	}
	switch body.Status {
	case "running", "stopped", "starting", "stopping", "crashed":
		return body.Status, nil
	default:
		return "", errors.New("Gluetun returned missing or unsupported VPN status data")
	}
}

func controlRunning(ctx context.Context, h *helpers.H) (bool, error) {
	status, err := controlStatus(ctx, h)
	if err != nil || status != "running" {
		return false, err
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/v1/publicip/ip", NoRedirect: true,
		Header: map[string]string{"X-API-Key": h.Secret(h.Key("control_api_key"))},
	})
	if err != nil {
		return false, fmt.Errorf("cannot read Gluetun public IP: %w", err)
	}
	if resp.Status != http.StatusOK {
		return false, fmt.Errorf("Gluetun public IP request returned HTTP %d; repair its read-only control key and retry self-host setup gluetun", resp.Status)
	}
	var body struct {
		IP *string `json:"public_ip"`
	}
	if resp.Decode(&body) != nil || body.IP == nil {
		return false, errors.New("Gluetun returned incomplete public IP data")
	}
	if *body.IP == "" {
		return false, nil
	}
	if ip, err := netip.ParseAddr(*body.IP); err != nil || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false, errors.New("Gluetun did not return a valid public IP address")
	}
	return true, nil
}
