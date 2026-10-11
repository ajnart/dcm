// Package lidarr is Lidarr: it manages music releases and imports them. Like
// the other Servarr Apps it writes an API key into config.xml on first start
// and Setup reads it back to require Forms authentication.
package lidarr

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Lidarr. Traps: docs/catalog/traps/lidarr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "lidarr", Name: "Lidarr", Category: "Requests",
		Description:   "Find, download and organize your music automatically",
		Image:         "lscr.io/linuxserver/lidarr:version-3.1.0.4875",
		Docs:          "https://wiki.servarr.com/lidarr",
		Port:          8686,
		ContainerPort: 8686,
		Service:       "lidarr",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

// api is the pinned Lidarr prefix; it is /api/v1, unlike Sonarr and Radarr.
const api = "/api/v1"

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  lidarr:
    image: lscr.io/linuxserver/lidarr:version-3.1.0.4875
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
    volumes:
      - ./config:/config
      - ./media-data:/data
    ports:
      - ${BIND_IP}:` + port + `:8686
    healthcheck:
      test: ["CMD-SHELL", "curl -fs -o /dev/null http://localhost:8686/ping || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

func request(h *helpers.H, req helpers.Request) helpers.Request {
	req.Path = api + req.Path
	req.Header = map[string]string{"X-Api-Key": h.Secret(h.Key("api_key"))}
	return req
}

func keyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("api_key")) == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, request(h, helpers.Request{Path: "/system/status"}))
	if err != nil {
		return false, err
	}
	if resp.Status != 200 {
		return false, fmt.Errorf("Lidarr API key verification returned HTTP %d", resp.Status)
	}
	var status struct {
		AppName string `json:"appName"`
		Version string `json:"version"`
	}
	if err := resp.Decode(&status); err != nil {
		return false, fmt.Errorf("Lidarr API key verification returned invalid status data")
	}
	if status.AppName != "Lidarr" || strings.TrimSpace(status.Version) == "" {
		return false, fmt.Errorf("Lidarr API key verification returned incomplete status data")
	}
	return true, nil
}

// readAPIKey waits for the key Lidarr writes to config.xml on first start.
func readAPIKey(ctx context.Context, h *helpers.H) error {
	key, err := h.ConfigValue(ctx, filepath.Join("config", "config.xml"), helpers.XMLElement("ApiKey"), 2*time.Minute)
	if err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), key)
}

// loginWorks submits the login form; a failure redirects to a location that
// carries loginFailed=true.
func loginWorks(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/login", NoRedirect: true,
		Form: map[string][]string{"username": {h.AdminUser()}, "password": {h.AdminPassword()}},
	})
	if err != nil {
		return false, err
	}
	if resp.Status < 300 || resp.Status > 399 {
		return false, fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	return !strings.Contains(resp.Header.Get("Location"), "loginFailed=true"), nil
}

func hostConfig(ctx context.Context, h *helpers.H) (map[string]any, error) {
	resp, err := h.Expect(ctx, request(h, helpers.Request{Path: "/config/host"}))
	if err != nil {
		return nil, err
	}
	var cfg map[string]any
	return cfg, resp.Decode(&cfg)
}

func authConfigured(ctx context.Context, h *helpers.H) (bool, error) {
	cfg, err := hostConfig(ctx, h)
	if err != nil {
		return false, err
	}
	if cfg["authenticationMethod"] != "forms" || cfg["authenticationRequired"] != "enabled" || cfg["username"] != h.AdminUser() {
		return false, nil
	}
	return loginWorks(ctx, h)
}

func setAuth(ctx context.Context, h *helpers.H) error {
	cfg, err := hostConfig(ctx, h)
	if err != nil {
		return err
	}
	cfg["authenticationMethod"] = "forms"
	cfg["authenticationRequired"] = "enabled"
	cfg["username"] = h.AdminUser()
	cfg["password"] = h.AdminPassword()
	cfg["passwordConfirmation"] = h.AdminPassword()
	id, _ := cfg["id"].(float64)
	if _, err := h.Expect(ctx, request(h, helpers.Request{
		Method: "PUT", Path: fmt.Sprintf("/config/host/%d", int(id)), JSON: cfg,
	})); err != nil {
		return err
	}
	if h.Poll(ctx, 30*time.Second, func(ctx context.Context) (bool, error) { return loginWorks(ctx, h) }) == nil {
		return nil
	}
	if err := h.Restart(ctx); err != nil {
		return err
	}
	return h.Poll(ctx, 2*time.Minute, func(ctx context.Context) (bool, error) { return loginWorks(ctx, h) })
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/ping"); err != nil {
		return err
	}
	err := h.Step(ctx, "api-key", "read the Lidarr API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return keyWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return readAPIKey(ctx, h) },
		Hint:  "Copy the API key from Lidarr > Settings > General into secrets.env as " + h.Key("api_key") + ".",
	})
	if err != nil {
		return err
	}
	return h.Step(ctx, "auth", "require the Admin login (forms authentication)", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return authConfigured(ctx, h) },
		Do:         func(ctx context.Context) error { return setAuth(ctx, h) },
		Hint:       "Open Lidarr > Settings > General > Security: set Authentication to Forms and enter the Admin login.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := keyWorks(ctx, h); !ok {
		return fmt.Errorf("the Lidarr API key is not accepted: %v", err)
	}
	if ok, err := authConfigured(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to Lidarr: %v", h.AdminUser(), err)
	}
	return nil
}
