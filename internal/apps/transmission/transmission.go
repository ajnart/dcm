// Package transmission is the Transmission torrent client: the container seeds
// its RPC login from the Admin env on first start and serves a private WebUI.
package transmission

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Transmission. Traps: docs/catalog/traps/transmission.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "transmission", Name: "Transmission", Category: "Downloads",
		Description:   "Download torrents in the background, light on your computer's resources",
		Image:         "linuxserver/transmission:latest",
		Docs:          "https://github.com/transmission/transmission/tree/main/docs",
		Port:          9091,
		ContainerPort: 9091,
		Service:       "transmission",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  transmission:
    image: linuxserver/transmission:latest
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      USER: ${ADMIN_USER}
      PASS: ${ADMIN_PASSWORD}
    volumes:
      - ./config:/config
      - ./media-data:/downloads
    ports:
      - ${BIND_IP}:` + port + `:9091
`
}

func (App) Links() []app.Link { return nil }

const rpcPath = "/transmission/rpc"

var errRPCAuthentication = errors.New("Transmission rejected the Project's Admin login; restore its RPC login and retry self-host setup transmission")

func rpcRead(ctx context.Context, h *helpers.H, user, password, method string, arguments map[string]any) (map[string]any, error) {
	request := helpers.Request{
		Method: "POST", Path: rpcPath, NoRedirect: true,
		JSON:   map[string]any{"method": method, "arguments": arguments},
		Header: map[string]string{}, User: user, Password: password,
	}
	for attempt := 0; attempt < 3; attempt++ {
		resp, err := h.HTTP(ctx, request)
		if err != nil {
			return nil, err
		}
		switch resp.Status {
		case 401:
			return nil, errRPCAuthentication
		case 403:
			return nil, errors.New("Transmission denied RPC access; review its existing IP whitelist or brute-force lockout, then retry Setup without disabling authentication or widening the whitelist")
		case 421:
			return nil, errors.New("Transmission denied the RPC Host; review its existing host policy, then retry Setup without disabling authentication or host protection")
		case 409:
			session := resp.Header.Get("X-Transmission-Session-Id")
			if session == "" {
				return nil, errors.New("Transmission returned no RPC session ID; retry self-host setup transmission")
			}
			request.Header["X-Transmission-Session-Id"] = session
			continue
		case 200:
			var payload struct {
				Result    string         `json:"result"`
				Arguments map[string]any `json:"arguments"`
			}
			if err := resp.Decode(&payload); err != nil || payload.Result != "success" || payload.Arguments == nil {
				return nil, errors.New("Transmission returned incomplete or failed RPC data; use Transmission 4.1.3 and retry self-host setup transmission")
			}
			return payload.Arguments, nil
		default:
			return nil, fmt.Errorf("Transmission RPC returned HTTP %d; retry self-host setup transmission", resp.Status)
		}
	}
	return nil, errors.New("Transmission RPC session negotiation did not finish; retry self-host setup transmission")
}

func rpcNumbers(value map[string]any, keys ...string) bool {
	for _, key := range keys {
		number, ok := value[key].(float64)
		if !ok || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) {
			return false
		}
	}
	return true
}

// This App-owned probe emits only the saved authentication boolean. It does
// not prove that a running daemon has reloaded a changed policy; no anonymous
// challenge is safe when Transmission's brute-force threshold may be one.
const configuredRPCAuthenticationProbe = `jq -e -r 'if type == "object" and (."rpc-authentication-required" | type) == "boolean" then ."rpc-authentication-required" | tostring else error("unavailable RPC authentication policy") end' /config/settings.json 2>/dev/null`

func verifyConfiguredRPCAuthentication(ctx context.Context, h *helpers.H) error {
	if h.Config.Exec != nil {
		result, err := h.Exec(ctx, nil, "sh", "-c", configuredRPCAuthenticationProbe)
		if err == nil && result.ExitCode == 0 && strings.TrimSpace(string(result.Stdout)) == "true" && len(result.Stderr) == 0 {
			return nil
		}
	}
	return fmt.Errorf("%w: Transmission's saved RPC authentication policy is disabled or cannot be verified; privately verify rpc-authentication-required=true, restart Transmission to apply it, preserve existing RPC IP/host whitelists, then retry self-host setup transmission and self-host setup homarr", helpers.ErrManual)
}

func rpcSession(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	if user == "" || password == "" {
		return false, nil
	}
	if err := verifyConfiguredRPCAuthentication(ctx, h); err != nil {
		return false, err
	}
	session, err := rpcRead(ctx, h, user, password, "session-get", map[string]any{"fields": []string{"version", "rpc-version-semver"}})
	if errors.Is(err, errRPCAuthentication) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	version, _ := session["version"].(string)
	if !helpers.VersionCompatible(version, "4.1.3") || !rpcSemverCompatible(session["rpc-version-semver"]) {
		return false, errors.New("Transmission's version or RPC contract is unsupported; back up Transmission before using Transmission 4.1.3 or newer 4.x, then retry self-host setup transmission")
	}
	statistics, err := rpcRead(ctx, h, user, password, "session-stats", map[string]any{})
	if err != nil {
		return false, err
	}
	if !rpcNumbers(statistics, "downloadSpeed", "uploadSpeed", "torrentCount", "activeTorrentCount", "pausedTorrentCount") {
		return false, errors.New("Transmission did not return explicit transfer rates and queue counts; retry self-host setup transmission")
	}
	queue, err := rpcRead(ctx, h, user, password, "torrent-get", map[string]any{"fields": []string{"hashString", "queuePosition", "status", "rateDownload", "rateUpload", "percentDone"}})
	if err != nil {
		return false, err
	}
	torrents, ok := queue["torrents"].([]any)
	if !ok {
		return false, errors.New("Transmission did not return its torrent queue; an explicit empty array is required for an empty queue")
	}
	for _, raw := range torrents {
		torrent, _ := raw.(map[string]any)
		hash, _ := torrent["hashString"].(string)
		if hash == "" || !rpcNumbers(torrent, "queuePosition", "status", "rateDownload", "rateUpload", "percentDone") {
			return false, errors.New("Transmission returned incomplete torrent queue data; retry self-host setup transmission")
		}
		state := torrent["status"].(float64)
		position := torrent["queuePosition"].(float64)
		if state > 6 || math.Trunc(state) != state || math.Trunc(position) != position || torrent["percentDone"].(float64) > 1 {
			return false, errors.New("Transmission returned unsupported torrent queue data; retry self-host setup transmission")
		}
	}
	return true, nil
}

func VerifyHomarr(ctx context.Context, h *helpers.H) error {
	if h.AdminUser() == "" || h.AdminPassword() == "" {
		return errors.New("Transmission's Project Admin login is missing; restore it through the Project secret boundary and retry self-host setup transmission, then self-host setup homarr")
	}
	ok, err := rpcSession(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return err
	}
	if !ok {
		return errRPCAuthentication
	}
	return nil
}

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{
			Path: "/transmission/web/", Want: []int{200, 401},
			Request: func(h *helpers.H) helpers.Request {
				return helpers.Request{User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true}
			},
		},
		Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
			ok, err := rpcSession(ctx, h, user, password)
			if err != nil {
				h.Info(err.Error())
			}
			return ok, err
		},
		Manual: "Transmission reads USER and PASS from the container environment on first start; " +
			"restore the Project's Admin login if it changed, keep RPC authentication enabled and preserve existing RPC IP/host whitelists. " +
			"Privately verify the saved rpc-authentication-required flag and restart Transmission to apply policy. " +
			"Setup must verify Transmission 4.1.3, session negotiation, queue data and transfer rates.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if h.AdminUser() == "" || h.AdminPassword() == "" {
		return fmt.Errorf("%w: Transmission's Project Admin login is missing; restore it through the Project secret boundary and retry self-host setup transmission", helpers.ErrManual)
	}
	return setup().Setup(ctx, h)
}

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }

func rpcSemverCompatible(value any) bool {
	semver, _ := value.(string)
	return helpers.VersionCompatible(semver, "6.0.1")
}

func (App) StandaloneGuide() string {
	return "Peers cannot connect in until you publish 51413 (tcp and udp) as well as the web port."
}
