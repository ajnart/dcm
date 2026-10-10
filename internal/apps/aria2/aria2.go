// Package aria2 is the aria2 token-authenticated download RPC daemon.
// Traps: docs/catalog/traps/aria2.md.
package aria2

import (
	"context"
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
		Description:   "A private download daemon that serves a token-authenticated JSON-RPC control API.",
		Image:         "snowdreamtech/aria2:1.37.0-debian",
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
    image: snowdreamtech/aria2:1.37.0-debian
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

func call(ctx context.Context, h *helpers.H, method, token string) (helpers.Response, error) {
	params := []string{}
	if token != "" {
		params = []string{"token:" + token}
	}
	return h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/jsonrpc",
		JSON: map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}})
}

// tokenWorks rejects unauthenticated RPC and verifies the saved token, the
// pinned version and the owned download directory.
func tokenWorks(ctx context.Context, h *helpers.H, token string) (bool, error) {
	anonymous, err := call(ctx, h, "aria2.getVersion", "")
	if err != nil {
		return false, err
	}
	if anonymous.Status == http.StatusOK {
		return false, nil
	}
	if token == "" {
		return false, nil
	}
	authorized, err := call(ctx, h, "aria2.getVersion", token)
	if err != nil {
		return false, err
	}
	if authorized.Status != http.StatusOK {
		return false, nil
	}
	var body struct {
		Error  any `json:"error"`
		Result struct {
			Version string `json:"version"`
		} `json:"result"`
	}
	if err := authorized.Decode(&body); err != nil {
		return false, err
	}
	if body.Error != nil || body.Result.Version != version {
		return false, nil
	}
	options, err := call(ctx, h, "aria2.getGlobalOption", token)
	if err != nil {
		return false, err
	}
	if options.Status != http.StatusOK {
		return false, nil
	}
	var global struct {
		Result struct {
			Dir string `json:"dir"`
		} `json:"result"`
	}
	if err := options.Decode(&global); err != nil {
		return false, err
	}
	return global.Result.Dir == downloads, nil
}

func ready(ctx context.Context, h *helpers.H, path string) error {
	probe := func(ctx context.Context) (bool, error) {
		resp, err := h.HTTP(ctx, helpers.Request{Path: path})
		if err != nil {
			return false, err
		}
		return resp.Status < 500, nil
	}
	return h.Step(ctx, "ready", "wait for the web server on "+path, helpers.StepSpec{
		Check: probe,
		Do:    func(ctx context.Context) error { return h.Poll(ctx, 2*time.Minute, probe) },
		Hint:  "Check the App's logs: self-host logs " + h.App,
	})
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := ready(ctx, h, "/jsonrpc"); err != nil {
		return err
	}
	token := h.Secret(h.Key("rpc_token"))
	return h.Step(ctx, "rpc-token", "authenticate aria2's RPC token", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return tokenWorks(ctx, h, token) },
		Hint: "Recreate the container so aria2 reads its RPC token from ./rpc-config: " +
			"self-host start aria2",
		Credential: h.Key("rpc_token"),
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
	return nil
}

func (App) Links() []app.Link { return nil }
