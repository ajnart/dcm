// Package lidarr is Lidarr: it manages music releases and imports them. Like
// the other Servarr Apps it writes an API key into config.xml on first start
// and Setup reads it back to require Forms authentication.
package lidarr

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/servarr"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Lidarr. Traps: docs/catalog/traps/lidarr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "lidarr", Name: "Lidarr", Category: "Requests",
		Description:   "Find, download and organize your music automatically",
		Image:         "lscr.io/linuxserver/lidarr:latest",
		Docs:          "https://wiki.servarr.com/lidarr",
		Port:          8686,
		ContainerPort: 8686,
		Service:       "lidarr",
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

var lidarrServarr = servarr.Servarr{Name: "Lidarr", API: servarr.V1}

const recoveryHint = "Preserve Lidarr's configuration and review Settings > General > Security. This Setup supports Lidarr 3.x API v1 with Forms authentication required for every address; unsupported or externally managed authentication needs review. Run self-host setup lidarr to reread its generated API key and retry; do not reinstall to retry."

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  lidarr:
    image: lscr.io/linuxserver/lidarr:latest
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
	return servarr.Request(h, servarr.V1, req)
}

func keyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if h.Secret(h.Key("api_key")) == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, request(h, helpers.Request{Path: "/system/status", NoRedirect: true}))
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
	parts := strings.Split(status.Version, ".")
	if len(parts) < 2 || len(parts) > 4 {
		return false, fmt.Errorf("Lidarr API key verification returned a malformed version")
	}
	var major uint64
	for index, part := range parts {
		value, err := strconv.ParseUint(part, 10, 31)
		if err != nil || strings.Trim(part, "0123456789") != "" {
			return false, fmt.Errorf("Lidarr API key verification returned a malformed version")
		}
		if index == 0 {
			major = value
		}
	}
	if major != 3 {
		return false, fmt.Errorf("%w: Lidarr's version is outside the supported 3.x API v1 contract; %s", helpers.ErrManual, recoveryHint)
	}
	return true, nil
}

// loginWorks submits the login form; a failure redirects to a location that
// carries loginFailed=true.
func loginWorks(ctx context.Context, h *helpers.H) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
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

func supportedHostConfig(ctx context.Context, h *helpers.H) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if ok, err := keyWorks(ctx, h); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("Lidarr's saved API key is missing; run self-host setup lidarr to reread its generated key")
	}
	resp, err := h.HTTP(ctx, helpers.Request{
		Path: "/api", Header: map[string]string{"X-Api-Key": h.Secret(h.Key("api_key"))}, NoRedirect: true,
	})
	if err != nil {
		return nil, err
	}
	if resp.Status == 404 || resp.Status == 405 || resp.Status == 501 {
		return nil, fmt.Errorf("%w: Lidarr's API discovery is unsupported; %s", helpers.ErrManual, recoveryHint)
	}
	if resp.Status != 200 {
		return nil, fmt.Errorf("Lidarr API discovery returned HTTP %d", resp.Status)
	}
	var info struct {
		Current string `json:"current"`
	}
	if err := resp.Decode(&info); err != nil || info.Current == "" {
		return nil, fmt.Errorf("Lidarr returned malformed API discovery data")
	}
	if info.Current != "v1" {
		return nil, fmt.Errorf("%w: Lidarr does not advertise the supported API v1 contract; %s", helpers.ErrManual, recoveryHint)
	}
	resp, err = h.HTTP(ctx, request(h, helpers.Request{Path: "/config/host", NoRedirect: true}))
	if err != nil {
		return nil, err
	}
	if resp.Status == 404 || resp.Status == 405 || resp.Status == 501 {
		return nil, fmt.Errorf("%w: Lidarr's host configuration API is unsupported; %s", helpers.ErrManual, recoveryHint)
	}
	if resp.Status != 200 {
		return nil, fmt.Errorf("Lidarr host configuration returned HTTP %d", resp.Status)
	}
	var cfg map[string]any
	if err := resp.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("Lidarr returned malformed host configuration")
	}
	if id, ok := cfg["id"].(float64); !ok || id != 1 {
		return nil, fmt.Errorf("Lidarr returned an invalid host configuration identifier")
	}
	for _, field := range []string{"authenticationMethod", "authenticationRequired", "username", "password", "passwordConfirmation", "apiKey"} {
		if _, ok := cfg[field].(string); !ok {
			return nil, fmt.Errorf("Lidarr returned incomplete or mistyped authentication configuration")
		}
	}
	if cfg["apiKey"] != h.Secret(h.Key("api_key")) {
		return nil, fmt.Errorf("Lidarr's host configuration does not identify its accepted API key; retry self-host setup lidarr")
	}
	if cfg["authenticationMethod"] != "none" && cfg["authenticationMethod"] != "forms" {
		return nil, fmt.Errorf("%w: Lidarr's authentication method cannot be changed automatically; %s", helpers.ErrManual, recoveryHint)
	}
	if cfg["authenticationRequired"] != "enabled" && cfg["authenticationRequired"] != "disabledForLocalAddresses" {
		return nil, fmt.Errorf("%w: Lidarr's required-authentication mode is unsupported; %s", helpers.ErrManual, recoveryHint)
	}
	return cfg, nil
}

func authConfigured(ctx context.Context, h *helpers.H) (bool, error) {
	cfg, err := supportedHostConfig(ctx, h)
	if err != nil {
		return false, err
	}
	if cfg["authenticationMethod"] != "forms" || cfg["authenticationRequired"] != "enabled" || cfg["username"] != h.AdminUser() {
		return false, nil
	}
	return loginWorks(ctx, h)
}

func setAuth(ctx context.Context, h *helpers.H) error {
	cfg, err := supportedHostConfig(ctx, h)
	if err != nil {
		return err
	}
	cfg["authenticationMethod"] = "forms"
	cfg["authenticationRequired"] = "enabled"
	cfg["username"] = h.AdminUser()
	cfg["password"] = h.AdminPassword()
	cfg["passwordConfirmation"] = h.AdminPassword()
	writeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	_, err = h.Expect(writeCtx, request(h, helpers.Request{
		Method: "PUT", Path: "/config/host/1", JSON: cfg, NoRedirect: true,
	}))
	cancel()
	if err != nil {
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
		Do:    func(ctx context.Context) error { return h.StoreAPIKey(ctx, lidarrServarr.APIKey(h)) },
		Hint:  recoveryHint,
	})
	if err != nil {
		return err
	}
	return h.Step(ctx, "auth", "require the Admin login (forms authentication)", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return authConfigured(ctx, h) },
		Do:         func(ctx context.Context) error { return setAuth(ctx, h) },
		Hint:       recoveryHint,
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := authConfigured(ctx, h); err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("Lidarr's required Forms Admin login could not be verified; run self-host setup lidarr")
	}
	return nil
}
