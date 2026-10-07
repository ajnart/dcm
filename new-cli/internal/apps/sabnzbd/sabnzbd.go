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
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is SABnzbd. Traps: docs/catalog/traps/sabnzbd.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "sabnzbd", Name: "SABnzbd", Category: "Downloads",
		Description:   "Downloads Usenet files from a provider you choose",
		Image:         "linuxserver/sabnzbd:version-5.1.3",
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
    image: linuxserver/sabnzbd:version-5.1.3
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
	return h.ConfigValue(ctx, "config/sabnzbd.ini", helpers.INIKey("misc", "api_key"), 2*time.Minute)
}

func apiForm(ctx context.Context, h *helpers.H, fields map[string]string) (map[string]any, error) {
	form := url.Values{}
	for key, value := range fields {
		form.Set(key, value)
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api", Form: form})
	if err != nil {
		return nil, err
	}
	if !resp.OK() {
		return nil, fmt.Errorf("the API returned HTTP %d", resp.Status)
	}
	var result map[string]any
	if err := resp.Decode(&result); err != nil {
		return nil, err
	}
	if status, ok := result["status"].(bool); ok && !status {
		return nil, errors.New("SABnzbd rejected the API request")
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
	return fmt.Sprint(misc[setting]), nil
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
	return username == "admin", nil
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

func setup() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/"},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Open SABnzbd > Config > General and set the WebUI username and password.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
