// Package aria2 is the aria2 token-authenticated download RPC daemon.
// Traps: docs/catalog/traps/aria2.md.
package aria2

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "aria2", Name: "Aria2", Category: "Downloads",
		Description:   "Download files and torrents in the background, controlled by other tools",
		Image:         "snowdreamtech/aria2:debian",
		Docs:          "https://aria2.github.io/manual/en/html/",
		Port:          6800,
		ContainerPort: 6800,
		Service:       "aria2",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets declares the RPC token. It is written into the private rpc-config
// file, never into Compose or the command line.
func (App) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "rpc_token", Length: 48}}
}

func (App) Files(rc app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{
		Path: "rpc-config",
		Content: "enable-rpc=true\nrpc-listen-all=true\nrpc-allow-origin-all=true\n" +
			"dir=" + downloads + "\nrpc-secret=" + secret("rpc_token") + "\n",
		Mode: 0o600,
	}}
}

const (
	version   = "1.37.0"
	downloads = "/var/lib/aria2/downloads"
)

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  aria2:
    image: snowdreamtech/aria2:debian
    entrypoint: ["/usr/bin/aria2c"]
    command: ["--conf-path=/run/secrets/rpc-config"]
    restart: unless-stopped
    volumes:
      - ./media-data:` + downloads + `
      - ./rpc-config:/run/secrets/rpc-config:ro
    ports:
      - ${BIND_IP}:` + port + `:6800
`
}

func call(ctx context.Context, h *helpers.H, method, token string, args ...any) (helpers.Response, error) {
	params := []any{}
	if token != "" {
		params = append(params, "token:"+token)
	}
	params = append(params, args...)
	return h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/jsonrpc",
		JSON: map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, NoRedirect: true})
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func decodeRPC(response helpers.Response) (rpcResponse, error) {
	var body rpcResponse
	if response.Decode(&body) != nil || body.JSONRPC != "2.0" || body.ID != 1 {
		return body, errors.New("aria2 did not return a valid JSON-RPC response on /jsonrpc")
	}
	return body, nil
}

func (r rpcResponse) unauthorized() bool {
	return r.Error != nil && r.Error.Code == 1 && r.Error.Message == "Unauthorized"
}

func rpcResult(response helpers.Response, result any) error {
	body, err := decodeRPC(response)
	if err != nil {
		return err
	}
	if response.Status != http.StatusOK || body.Error != nil || len(body.Result) == 0 || string(body.Result) == "null" {
		return errors.New("aria2 rejected the authenticated RPC request")
	}
	if json.Unmarshal(body.Result, result) != nil {
		return errors.New("aria2 returned an unexpected RPC result")
	}
	return nil
}

func tokenWorks(ctx context.Context, h *helpers.H, token string) (bool, error) {
	anonymous, err := call(ctx, h, "aria2.getVersion", "")
	if err != nil {
		return false, err
	}
	body, err := decodeRPC(anonymous)
	if err != nil {
		return false, err
	}
	if !body.unauthorized() || (anonymous.Status != http.StatusBadRequest && anonymous.Status != http.StatusOK) {
		return false, nil
	}
	if token == "" {
		return false, nil
	}
	authorized, err := call(ctx, h, "aria2.getVersion", token)
	if err != nil {
		return false, err
	}
	var installed struct {
		Version string `json:"version"`
	}
	if err := rpcResult(authorized, &installed); err != nil {
		return false, err
	}
	if !helpers.VersionCompatible(installed.Version, version) {
		return false, nil
	}
	options, err := call(ctx, h, "aria2.getGlobalOption", token)
	if err != nil {
		return false, err
	}
	var global struct {
		Dir string `json:"dir"`
	}
	if err := rpcResult(options, &global); err != nil {
		return false, err
	}
	return global.Dir == downloads, nil
}

func downloadsWork(ctx context.Context, h *helpers.H, token string) (bool, error) {
	response, err := call(ctx, h, "aria2.getGlobalStat", token)
	if err != nil {
		return false, err
	}
	var stats map[string]string
	if err := rpcResult(response, &stats); err != nil {
		return false, err
	}
	for _, key := range []string{"downloadSpeed", "uploadSpeed", "numActive", "numWaiting", "numStopped", "numStoppedTotal"} {
		if _, err := strconv.ParseUint(stats[key], 10, 64); err != nil {
			return false, errors.New("aria2 did not return valid queue counts and transfer rates")
		}
	}
	keys := []string{"gid", "status"}
	for _, method := range []string{"aria2.tellActive", "aria2.tellWaiting", "aria2.tellStopped"} {
		args := []any{0, 1, keys}
		if method == "aria2.tellActive" {
			args = []any{keys}
		}
		response, err := call(ctx, h, method, token, args...)
		if err != nil {
			return false, err
		}
		var queue []struct {
			GID    string `json:"gid"`
			Status string `json:"status"`
		}
		if err := rpcResult(response, &queue); err != nil {
			return false, err
		}
		for _, item := range queue {
			if item.GID == "" {
				return false, errors.New("aria2 returned a queue item without its identifier")
			}
			switch item.Status {
			case "active", "waiting", "paused", "complete", "error", "removed":
			default:
				return false, errors.New("aria2 returned a queue item without a supported status")
			}
		}
	}
	return true, nil
}

func ready(ctx context.Context, h *helpers.H) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := call(ctx, h, "aria2.getVersion", "")
		if err != nil {
			return false, err
		}
		body, err := decodeRPC(resp)
		if err != nil {
			return false, err
		}
		if body.unauthorized() && (resp.Status == http.StatusBadRequest || resp.Status == http.StatusOK) {
			return true, nil
		}
		return resp.Status == http.StatusOK && body.Error == nil && len(body.Result) > 0, nil
	}
	return h.Step(ctx, "ready", "wait for aria2's RPC listener on /jsonrpc", helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h); err != nil {
		return err
	}
	token := h.Secret(h.Key("rpc_token"))
	if err := h.Step(ctx, "rpc-token", "authenticate aria2's RPC token", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return tokenWorks(ctx, h, token) },
		Hint: "Inspect and review aria2's existing Compose, authentication, mounts and ports; " +
			"reinstall replaces Compose and private configuration, not just credentials. " +
			"Stop if protected configuration cannot be preserved. " +
			"Only after separate explicit approval of the replacement, run self-host install aria2 --yes, " +
			"then self-host restart aria2 and self-host setup aria2.",
		Credential: h.Key("rpc_token"),
	}); err != nil {
		return err
	}
	return h.Step(ctx, "rpc-data", "verify aria2's queue and transfer information", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return downloadsWork(ctx, h, token) },
		Hint:  "Run self-host debug aria2, repair its authenticated RPC listener, then self-host setup aria2.",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	ok, err := tokenWorks(ctx, h, h.Secret(h.Key("rpc_token")))
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("aria2 did not accept its saved RPC token or reports a different version or download directory")
	}
	_, err = downloadsWork(ctx, h, h.Secret(h.Key("rpc_token")))
	return err
}

func (App) Links() []app.Link { return nil }
