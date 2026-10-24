// Package sabnzbd is SABnzbd: it downloads authorized Usenet files. Setup
// reads the generated API key from its config and sets the WebUI login
// through the private form API.
package sabnzbd

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is SABnzbd. Traps: docs/catalog/traps/sabnzbd.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "sabnzbd", Name: "SABnzbd", Category: "Downloads",
		Description:   "Automatically fetch files from Usenet, a paid file-sharing service",
		Image:         "linuxserver/sabnzbd:latest",
		Docs:          "https://sabnzbd.org/wiki/",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "sabnzbd",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  sabnzbd:
    image: linuxserver/sabnzbd:latest
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
    volumes:
      - ./config:/config
      - ./media-data:/data
    ports:
      - ${BIND_IP}:` + port + `:8080
`
}

func (App) Links() []app.Link { return nil }

// readAPIKey waits for the key SABnzbd writes to its config on first start.
func readAPIKey(ctx context.Context, h *helpers.H) (string, error) {
	key, err := h.ConfigValue(ctx, "config/sabnzbd.ini", helpers.INIKey("misc", "api_key"), 2*time.Minute)
	if err == nil {
		h.Log.Secret(key)
	}
	return key, err
}

func apiForm(ctx context.Context, h *helpers.H, fields map[string]string) (map[string]any, error) {
	form := url.Values{}
	form.Set("output", "json")
	for key, value := range fields {
		form.Set(key, value)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api", Form: form, NoRedirect: true})
	if err != nil {
		return nil, err
	}
	if !resp.OK() {
		if strings.Contains(string(resp.Body), "Hostname verification failed") {
			return nil, errors.New("SABnzbd refused its hostname; review Config > Special > host_whitelist for the Project Address without disabling hostname checks")
		}
		if strings.Contains(string(resp.Body), "External internet access denied") {
			return nil, errors.New("SABnzbd refused the Project connection; review its private network access settings without enabling public Access")
		}
		return nil, fmt.Errorf("SABnzbd API returned HTTP %d; verify the full API key in Config > General and retry self-host setup sabnzbd", resp.Status)
	}
	var result map[string]any
	if err := resp.Decode(&result); err != nil {
		return nil, err
	}
	if status, ok := result["status"].(bool); ok && !status {
		return nil, errors.New("SABnzbd rejected the API request")
	}
	if failure, found := result["error"]; found && failure != nil {
		return nil, errors.New("SABnzbd returned an API error; review Config > General and retry self-host setup sabnzbd")
	}
	return result, nil
}

func readSetting(ctx context.Context, h *helpers.H, key, setting string) (string, error) {
	result, err := apiForm(ctx, h, map[string]string{
		"mode": "get_config", "section": "misc", "keyword": setting, "apikey": key,
	})
	if err != nil {
		return "", err
	}
	config, _ := result["config"].(map[string]any)
	misc, _ := config["misc"].(map[string]any)
	value, ok := misc[setting].(string)
	if !ok {
		return "", errors.New("SABnzbd did not return the requested setting")
	}
	return value, nil
}

func setSetting(ctx context.Context, h *helpers.H, key, setting, value string) error {
	_, err := apiForm(ctx, h, map[string]string{
		"mode": "set_config", "section": "misc", "keyword": setting, "value": value, "apikey": key,
	})
	return err
}

// exists reports whether the WebUI already has the administrator username.
func exists(ctx context.Context, h *helpers.H) (bool, error) {
	key, err := readAPIKey(ctx, h)
	if err != nil {
		return false, nil
	}
	username, err := readSetting(ctx, h, key, "username")
	if err != nil {
		return false, err
	}
	return username == h.AdminUser(), nil
}

func create(ctx context.Context, h *helpers.H, user, password string) error {
	key, err := readAPIKey(ctx, h)
	if err != nil {
		return err
	}
	username, err := readSetting(ctx, h, key, "username")
	if err != nil {
		return err
	}
	if username != "" && username != user {
		return errors.New("SABnzbd already has a different administrator; it is left as it is")
	}
	if username == "" {
		if err := setSetting(ctx, h, key, "username", user); err != nil {
			return err
		}
	}
	return setSetting(ctx, h, key, "password", password)
}

// loginWorks submits the WebUI login form; success mints the login cookie.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/login/", NoRedirect: true,
		Form: map[string][]string{"username": {user}, "password": {password}},
	})
	if err != nil {
		return false, err
	}
	if resp.Status != 302 && resp.Status != 303 {
		return false, nil
	}
	return resp.Cookie("login_cookie") != "", nil
}

func setup() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/api?mode=version&output=json", Contains: `"version"`},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Open SABnzbd > Config > General and set the WebUI username and password.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := setup().Setup(ctx, h); err != nil {
		return err
	}
	if err := h.Step(ctx, "api-key", "verify the full SABnzbd API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			if h.Secret(h.Key("api_key")) == "" {
				return false, nil
			}
			_, err := verifyAPIKey(ctx, h, h.Secret(h.Key("api_key")))
			return err == nil, err
		},
		Do: func(ctx context.Context) error {
			key, err := readAPIKey(ctx, h)
			if err != nil {
				return err
			}
			h.Log.Secret(key)
			if _, err := verifyAPIKey(ctx, h, key); err != nil {
				return err
			}
			return h.SetSecret(h.Key("api_key"), key)
		},
		Hint: "Run self-host setup sabnzbd to recover its existing full API key from the Project config, then self-host setup homarr. The NZB key only uploads jobs; do not rotate keys or disable authentication.",
	}); err != nil {
		return err
	}
	return h.Step(ctx, "provider", "check for an existing Usenet provider", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return providerConfigured(ctx, h) },
		Do: func(ctx context.Context) error {
			configured, err := providerConfigured(ctx, h)
			if err != nil {
				return err
			}
			if configured {
				return nil
			}
			return fmt.Errorf("%w: the API is ready, but no enabled Usenet provider is configured", helpers.ErrManual)
		},
		Hint:       "Open SABnzbd > Config > Servers (or its first-run wizard) and configure your own authorized Usenet provider, then run self-host setup sabnzbd and self-host setup homarr. No provider account is created or tested by Setup.",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := setup().Check(ctx, h); err != nil {
		return err
	}
	if _, err := verifyAPIKey(ctx, h, h.Secret(h.Key("api_key"))); err != nil {
		return err
	}
	configured, err := providerConfigured(ctx, h)
	if err != nil {
		return err
	}
	if !configured {
		return fmt.Errorf("%w: the SABnzbd API is ready, but no enabled Usenet provider is configured; open Config > Servers and retry self-host setup sabnzbd", helpers.ErrManual)
	}
	return nil
}
