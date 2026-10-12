// Package nzbget is the NZBGet Usenet downloader. Its control interface takes
// the Admin login as environment variables and speaks a Basic-authenticated
// JSON-RPC API.
package nzbget

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// version is the pinned image's RPC version.
const version = "26.3"

// App is NZBGet. Traps: docs/catalog/traps/nzbget.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "nzbget", Name: "NZBGet", Category: "Downloads",
		Description:   "Download files from your Usenet provider, a paid file-sharing service",
		Image:         "ghcr.io/nzbgetcom/nzbget:v26.3",
		Docs:          "https://nzbget.com/documentation/",
		Port:          6789,
		ContainerPort: 6789,
		Service:       "nzbget",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  nzbget:
    image: ghcr.io/nzbgetcom/nzbget:v26.3
    restart: unless-stopped
    environment:
      NZBGET_USER: ${ADMIN_USER}
      NZBGET_PASS: ${ADMIN_PASSWORD}
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
    volumes:
      - ./config:/config
      - ${DOWNLOADS_ROOT}:/downloads
    ports:
      - ${BIND_IP}:` + port + `:6789
`
}

func rpc() map[string]any {
	return map[string]any{"version": "1.1", "method": "version", "params": []any{}, "id": "selfhost-version"}
}

// adminWorks proves the RPC interface rejects anonymous reads and accepts the
// saved administrator's Basic credentials with the pinned version.
func adminWorks(ctx context.Context, h *helpers.H) (bool, error) {
	anonymous, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/jsonrpc", JSON: rpc(), NoRedirect: true})
	if err != nil {
		return false, err
	}
	if anonymous.Status != http.StatusUnauthorized {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/jsonrpc", JSON: rpc(), NoRedirect: true, User: h.AdminUser(), Password: h.AdminPassword()})
	if err != nil {
		return false, err
	}
	if resp.Status != http.StatusOK {
		return false, nil
	}
	var result struct {
		ID     string `json:"id"`
		Error  any    `json:"error"`
		Result string `json:"result"`
	}
	if err := resp.Decode(&result); err != nil {
		return false, err
	}
	return result.ID == "selfhost-version" && result.Error == nil && result.Result == version, nil
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/"); err != nil {
		return err
	}
	if err := h.Step(ctx, "admin-rpc", "verify the administrator "+h.AdminUser(), helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return adminWorks(ctx, h) },
		Do: func(context.Context) error {
			return errors.New("NZBGet reads NZBGET_USER and NZBGET_PASS only when the container starts")
		},
		Hint: "NZBGet applies the Admin login when the container starts. Recreate the container: self-host start nzbget, " +
			"then open " + h.URL + " and sign in with the password from `self-host credentials`.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	if err := h.Step(ctx, "homarr-rpc", "prepare restricted NZBGet access for Homarr", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return VerifyHomarr(ctx, h) == nil, nil },
		Do:    func(ctx context.Context) error { return prepareHomarr(ctx, h) },
		Hint: "Run self-host setup nzbget to prepare its Homarr login. If restricted access already exists, keep it unchanged: " +
			"restore the managed login through the Project secret boundary or explicitly clear only the restricted-user slot in NZBGet settings, then retry. " +
			"A Usenet provider is separate and is not created by Setup.",
		Credential: "admin",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "usenet-provider", "review NZBGet Usenet provider settings", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return providerConfigured(ctx, h) },
		Do: func(ctx context.Context) error {
			configured, err := providerConfigured(ctx, h)
			if err != nil {
				return err
			}
			if configured {
				return nil
			}
			h.Info("NZBGet RPC is ready, but no enabled Usenet provider with a non-placeholder host, valid port and positive connection count is configured. Review Settings > News-Servers with your own provider, save and apply them, then run self-host setup nzbget. Setup creates no account and makes no provider request.")
			return helpers.ErrManual
		},
		Hint: "Review Settings > News-Servers in NZBGet, save and apply your own provider settings, then run self-host setup nzbget. " +
			"This checks configuration only, not provider authentication, connectivity or a download; an idle queue remains valid.",
		Credential: "admin",
	})
}

func providerConfigured(ctx context.Context, h *helpers.H) (bool, error) {
	var entries []struct {
		Name  string
		Value *string
	}
	if err := callRPC(ctx, h, h.AdminUser(), h.AdminPassword(), "config", &entries); err != nil {
		return false, err
	}
	if entries == nil {
		return false, errors.New("NZBGet did not return its active provider settings; retry self-host setup nzbget")
	}
	servers := map[string]map[string]string{}
	for _, entry := range entries {
		prefix, key, found := strings.Cut(entry.Name, ".")
		if !found || !strings.HasPrefix(prefix, "Server") {
			continue
		}
		index, err := strconv.Atoi(strings.TrimPrefix(prefix, "Server"))
		if err != nil || index <= 0 {
			continue
		}
		if key != "Active" && key != "Host" && key != "Port" && key != "Connections" {
			continue
		}
		if servers[prefix] == nil {
			servers[prefix] = map[string]string{}
		}
		if _, duplicate := servers[prefix][key]; duplicate || entry.Value == nil {
			return false, errors.New("NZBGet returned incomplete provider settings; review Settings > News-Servers and retry self-host setup nzbget")
		}
		value := *entry.Value
		if key == "Active" {
			switch strings.ToLower(value) {
			case "yes", "true", "1", "on", "enable", "enabled":
				value = "yes"
			case "no", "false", "0", "off", "disable", "disabled":
				value = "no"
			default:
				return false, errors.New("NZBGet returned an invalid provider enabled setting; review Settings > News-Servers and retry self-host setup nzbget")
			}
		}
		servers[prefix][key] = value
	}
	for _, server := range servers {
		if server["Active"] == "no" {
			continue
		}
		host := strings.TrimSpace(server["Host"])
		port, portErr := strconv.Atoi(server["Port"])
		connections, connectionsErr := strconv.Atoi(server["Connections"])
		if host != "" && !strings.EqualFold(host, "my.newsserver.com") && portErr == nil && port > 0 && port <= 65535 && connectionsErr == nil && connections > 0 && connections <= 999 {
			return true, nil
		}
	}
	return false, nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := adminWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot read NZBGet's version over RPC: %v", h.AdminUser(), err)
	}
	return VerifyHomarr(ctx, h)
}

func (App) Links() []app.Link { return nil }
