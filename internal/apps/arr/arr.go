// Package arr holds Sonarr, Radarr and Prowlarr. They share one shape: a
// linuxserver.io image, an API key generated into config.xml on first start,
// forms authentication set through the host config API, and Links made
// through their v3 (Sonarr, Radarr) or v1 (Prowlarr) APIs.
package arr

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type App struct {
	info app.Info
	// api is the API prefix: /api/v3 or /api/v1.
	api string
	// rootFolder is the library folder Setup registers; empty for Prowlarr.
	rootFolder string
	links      []app.Link
}

func Sonarr() App {
	return App{
		info: app.Info{
			ID: "sonarr", Name: "Sonarr", Category: "Media",
			Description:   "Finds, downloads and organizes TV series",
			Image:         "lscr.io/linuxserver/sonarr:latest",
			Docs:          "https://wiki.servarr.com/sonarr",
			Port:          8989,
			ContainerPort: 8989,
			Service:       "sonarr",
			UsesMedia:     true,
		},
		api:        "/api/v3",
		rootFolder: "/media/tv",
		links:      []app.Link{downloadClientLink("tvCategory", "tv")},
	}
}

func Radarr() App {
	return App{
		info: app.Info{
			ID: "radarr", Name: "Radarr", Category: "Media",
			Description:   "Finds, downloads and organizes movies",
			Image:         "lscr.io/linuxserver/radarr:latest",
			Docs:          "https://wiki.servarr.com/radarr",
			Port:          7878,
			ContainerPort: 7878,
			Service:       "radarr",
			UsesMedia:     true,
		},
		api:        "/api/v3",
		rootFolder: "/media/movies",
		links:      []app.Link{downloadClientLink("movieCategory", "movies")},
	}
}

func Prowlarr() App {
	return App{
		info: app.Info{
			ID: "prowlarr", Name: "Prowlarr", Category: "Media",
			Description:   "Indexer manager that feeds Sonarr and Radarr",
			Image:         "lscr.io/linuxserver/prowlarr:latest",
			Docs:          "https://wiki.servarr.com/prowlarr",
			Port:          9696,
			ContainerPort: 9696,
			Service:       "prowlarr",
			UsesMedia:     true,
		},
		api:   "/api/v1",
		links: []app.Link{applicationLink("sonarr"), applicationLink("radarr")},
	}
}

func (a App) Info() app.Info    { return a.info }
func (App) Inputs() []app.Input { return nil }
func (a App) Links() []app.Link { return a.links }

func (a App) Compose(rc app.RenderContext) string {
	id := a.info.ID
	inner := strconv.Itoa(a.info.ContainerPort)
	mounts := ""
	if a.rootFolder != "" {
		mounts = "      - ${MEDIA_ROOT}:/media\n      - ${DOWNLOADS_ROOT}:/downloads\n"
	}
	return `services:
  ` + id + `:
    image: ` + a.info.Image + `
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
    volumes:
      - ./config:/config
` + mounts + `    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:` + inner + `
    healthcheck:
      test: ["CMD-SHELL", "curl -fs -o /dev/null http://localhost:` + inner + `/ping || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

// request adds the API key to req; path is relative to the API prefix.
func (a App) request(h *helpers.H, req helpers.Request) helpers.Request {
	req.Path = a.api + req.Path
	req.Header = map[string]string{"X-Api-Key": h.Secret(h.Key("api_key"))}
	return req
}

var apiKeyElement = regexp.MustCompile(`<ApiKey>\s*([^<\s]+)\s*</ApiKey>`)

func (a App) keyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("api_key")) == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, a.request(h, helpers.Request{Path: "/system/status"}))
	return err == nil && resp.Status == 200, err
}

// readAPIKey waits for the key the App writes to config.xml on first start.
func (a App) readAPIKey(ctx context.Context, h *helpers.H) error {
	path := filepath.Join(h.Dir, "config", "config.xml")
	var key string
	err := h.Poll(ctx, 2*time.Minute, func(context.Context) (bool, error) {
		data, err := os.ReadFile(path)
		if err != nil {
			return false, err
		}
		found := apiKeyElement.FindSubmatch(data)
		if found == nil {
			return false, errors.New("no ApiKey in config.xml yet")
		}
		key = string(found[1])
		return true, nil
	})
	if err != nil {
		return err
	}
	return h.SetSecret(h.Key("api_key"), key)
}

// loginWorks submits the login form with the Admin login. Failure redirects
// to a location carrying loginFailed=true.
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

type hostConfig map[string]any

func (a App) hostConfig(ctx context.Context, h *helpers.H) (hostConfig, error) {
	resp, err := h.Expect(ctx, a.request(h, helpers.Request{Path: "/config/host"}))
	if err != nil {
		return nil, err
	}
	var cfg hostConfig
	return cfg, resp.Decode(&cfg)
}

func (a App) authConfigured(ctx context.Context, h *helpers.H) (bool, error) {
	cfg, err := a.hostConfig(ctx, h)
	if err != nil {
		return false, err
	}
	if cfg["authenticationMethod"] != "forms" || cfg["authenticationRequired"] != "enabled" || cfg["username"] != h.AdminUser() {
		return false, nil
	}
	return loginWorks(ctx, h)
}

func (a App) setAuth(ctx context.Context, h *helpers.H) error {
	cfg, err := a.hostConfig(ctx, h)
	if err != nil {
		return err
	}
	cfg["authenticationMethod"] = "forms"
	cfg["authenticationRequired"] = "enabled"
	cfg["username"] = h.AdminUser()
	cfg["password"] = h.AdminPassword()
	cfg["passwordConfirmation"] = h.AdminPassword()
	id, _ := cfg["id"].(float64)
	if _, err := h.Expect(ctx, a.request(h, helpers.Request{
		Method: "PUT", Path: fmt.Sprintf("/config/host/%d", int(id)), JSON: cfg,
	})); err != nil {
		return err
	}
	// The App may restart to apply authentication.
	return h.Poll(ctx, time.Minute, loginPoll(h))
}

func loginPoll(h *helpers.H) func(context.Context) (bool, error) {
	return func(ctx context.Context) (bool, error) { return loginWorks(ctx, h) }
}

type rootFolder struct {
	Path string `json:"path"`
}

func (a App) hasRootFolder(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.Expect(ctx, a.request(h, helpers.Request{Path: "/rootfolder"}))
	if err != nil {
		return false, err
	}
	var folders []rootFolder
	if err := resp.Decode(&folders); err != nil {
		return false, err
	}
	for _, folder := range folders {
		if folder.Path == a.rootFolder {
			return true, nil
		}
	}
	return false, nil
}

func (a App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/ping", 2*time.Minute); err != nil {
		return err
	}
	name := a.info.Name
	err := h.Step(ctx, "api-key", "read the "+name+" API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return a.keyWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return a.readAPIKey(ctx, h) },
		Hint:  "Copy the API key from " + name + " > Settings > General into secrets.env as " + h.Key("api_key") + ".",
	})
	if err != nil {
		return err
	}
	err = h.Step(ctx, "auth", "require the Admin login (forms authentication)", helpers.StepSpec{
		Check:      func(ctx context.Context) (bool, error) { return a.authConfigured(ctx, h) },
		Do:         func(ctx context.Context) error { return a.setAuth(ctx, h) },
		Hint:       "Open " + name + " > Settings > General > Security: set Authentication to Forms and enter the Admin login.",
		Credential: "admin",
	})
	if err != nil || a.rootFolder == "" {
		return err
	}
	return h.Step(ctx, "root-folder", "add the root folder "+a.rootFolder, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return a.hasRootFolder(ctx, h) },
		Do: func(ctx context.Context) error {
			if _, err := h.Exec(ctx, nil, "s6-setuidgid", "abc", "mkdir", "-p", a.rootFolder); err != nil {
				return err
			}
			_, err := h.Expect(ctx, a.request(h, helpers.Request{Method: "POST", Path: "/rootfolder", JSON: rootFolder{Path: a.rootFolder}}))
			return err
		},
		Hint:       "Open " + name + " > Settings > Media Management > Add Root Folder and choose " + a.rootFolder + ".",
		Credential: "admin",
	})
}

func (a App) Check(ctx context.Context, h *helpers.H) error {
	if ok, err := a.keyWorks(ctx, h); !ok {
		return fmt.Errorf("the %s API key is not accepted: %v", a.info.Name, err)
	}
	if ok, err := loginWorks(ctx, h); !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to %s: %v", h.AdminUser(), a.info.Name, err)
	}
	return nil
}
