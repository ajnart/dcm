// Package syncthing is Syncthing: it synchronizes selected folders and serves
// a private administration GUI, whose login Setup sets through its REST API.
package syncthing

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/onboard"
)

// App is Syncthing. Traps: docs/catalog/traps/syncthing.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "syncthing", Name: "Syncthing", Category: "Files",
		Description:   "Keeps folders in sync between your own devices",
		Image:         "syncthing/syncthing:2.1.4",
		Docs:          "https://docs.syncthing.net/",
		Port:          8384,
		ContainerPort: 8384,
		Service:       "syncthing",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  syncthing:
    image: syncthing/syncthing:2.1.4
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
    volumes:
      - ./syncthing-data:/var/syncthing
    ports:
      - ${BIND_IP}:` + port + `:8384
`
}

func (App) Links() []app.Link { return nil }

var apiKeyElement = regexp.MustCompile(`<apikey>([^<]+)</apikey>`)

func configXML(h *helpers.H) string {
	return filepath.Join(h.Dir, "syncthing-data", "config", "config.xml")
}

// readAPIKey waits for the key Syncthing writes to its config on first start.
func readAPIKey(ctx context.Context, h *helpers.H) (string, error) {
	var key string
	err := h.Poll(ctx, 2*time.Minute, func(context.Context) (bool, error) {
		data, err := os.ReadFile(configXML(h))
		if err != nil {
			return false, err
		}
		found := apiKeyElement.FindSubmatch(data)
		if found == nil {
			return false, errors.New("no api key in config.xml yet")
		}
		key = string(found[1])
		return true, nil
	})
	return key, err
}

type gui struct {
	User                string `json:"user"`
	Password            string `json:"password"`
	SendBasicAuthPrompt bool   `json:"sendBasicAuthPrompt"`
}

func guiConfig(ctx context.Context, h *helpers.H, key string) (gui, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/rest/config/gui", Header: map[string]string{"X-API-Key": key}})
	if err != nil {
		return gui{}, err
	}
	if !resp.OK() {
		return gui{}, fmt.Errorf("the GUI configuration returned HTTP %d", resp.Status)
	}
	var config gui
	return config, resp.Decode(&config)
}

func savedKey(ctx context.Context, h *helpers.H) (string, bool, error) {
	data, err := os.ReadFile(configXML(h))
	if err != nil {
		return "", false, nil
	}
	found := apiKeyElement.FindSubmatch(data)
	if found == nil {
		return "", false, nil
	}
	return string(found[1]), true, nil
}

// exists reports whether the GUI already has credentials.
func exists(ctx context.Context, h *helpers.H) (bool, error) {
	key, found, err := savedKey(ctx, h)
	if err != nil || !found {
		return false, err
	}
	config, err := guiConfig(ctx, h, key)
	if err != nil {
		return false, err
	}
	return config.User != "" || config.Password != "", nil
}

// loginWorks proves the saved administrator through HTTP basic auth.
func loginWorks(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/", User: user, Password: password})
	if err != nil {
		return false, err
	}
	if resp.Status == 401 {
		return false, nil
	}
	if !resp.OK() {
		return false, fmt.Errorf("the GUI returned HTTP %d", resp.Status)
	}
	return true, nil
}

func create(ctx context.Context, h *helpers.H, user, password string) error {
	key, err := readAPIKey(ctx, h)
	if err != nil {
		return err
	}
	config, err := guiConfig(ctx, h, key)
	if err != nil {
		return err
	}
	if config.User != "" || config.Password != "" {
		return errors.New("Syncthing already has GUI credentials; it is left as it is")
	}
	_, err = h.Expect(ctx, helpers.Request{
		Method: "PATCH", Path: "/rest/config/gui",
		Header: map[string]string{"X-API-Key": key, "Content-Type": "application/json"},
		JSON:   map[string]any{"user": user, "password": password, "sendBasicAuthPrompt": true},
	})
	return err
}

func setup() onboard.FirstAdmin {
	return onboard.FirstAdmin{
		Ready:  onboard.Probe{Path: "/rest/noauth/health"},
		Exists: exists,
		Create: create,
		Login:  loginWorks,
		Manual: "Open Syncthing > Actions > Settings > GUI and set the administrator login.",
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error { return setup().Setup(ctx, h) }

func (App) Check(ctx context.Context, h *helpers.H) error { return setup().Check(ctx, h) }
