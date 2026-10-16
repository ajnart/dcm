// Package cleanuparr is Cleanuparr. Traps: docs/catalog/traps/cleanuparr.md.
package cleanuparr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
)

// App is Cleanuparr. Traps: docs/catalog/traps/cleanuparr.md.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "cleanuparr", Name: "Cleanuparr", Category: "Requests",
		Description:   "Remove stuck, fake or unwanted downloads for your movie and show apps",
		Image:         "ghcr.io/cleanuparr/cleanuparr:2.10.10",
		Docs:          "https://cleanuparr.github.io/docs/installation/detailed",
		Port:          11011,
		ContainerPort: 11011,
		Service:       "cleanuparr",
	}
}

func (App) Inputs() []app.Input { return nil }

func (App) Links() []app.Link {
	return []app.Link{arrLink("sonarr", "Sonarr", 4), arrLink("radarr", "Radarr", 6), qbittorrentLink()}
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  cleanuparr:
    image: ghcr.io/cleanuparr/cleanuparr:2.10.10
    restart: unless-stopped
    environment:
      PORT: "11011"
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
    volumes:
      - ./config:/config
    ports:
      - ${BIND_IP}:` + port + `:11011
`
}

func admin() firstadmin.FirstAdmin {
	return firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{Path: "/health"},
		Exists: setupCompleted,
		Create: createAdmin,
		Login: func(ctx context.Context, h *helpers.H, user, password string) (bool, error) {
			_, ok, err := login(ctx, h, user, password)
			return ok, err
		},
		Valid: func(user, password string) error {
			if len(user) < 3 || len(user) > 50 || len(password) < 8 || len(password) > 128 {
				return errors.New("Cleanuparr needs a username of 3 to 50 characters and a password of 8 to 128")
			}
			return nil
		},
	}
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return admin().Setup(ctx, h)
}

// Check proves the Admin login signs in; what Cleanuparr is connected to is
// the Links' job.
func (App) Check(ctx context.Context, h *helpers.H) error {
	return admin().Check(ctx, h)
}

func setupCompleted(ctx context.Context, h *helpers.H) (bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/api/auth/status"})
	if err != nil {
		return false, err
	}
	var status struct {
		SetupCompleted *bool `json:"setupCompleted"`
	}
	if resp.Status != http.StatusOK || resp.Decode(&status) != nil || status.SetupCompleted == nil {
		return false, fmt.Errorf("Cleanuparr /api/auth/status returned HTTP %d without its setup state", resp.Status)
	}
	return *status.SetupCompleted, nil
}

func createAdmin(ctx context.Context, h *helpers.H, user, password string) error {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/auth/setup/account",
		JSON: map[string]string{"username": user, "password": password}})
	if err != nil {
		return h.Log.RedactError(err)
	}
	if resp.Status != http.StatusCreated && resp.Status != http.StatusConflict {
		return fmt.Errorf("Cleanuparr account creation returned HTTP %d", resp.Status)
	}
	resp, err = h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/auth/setup/complete"})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Cleanuparr setup completion returned HTTP %d", resp.Status)
	}
	return nil
}

func login(ctx context.Context, h *helpers.H, user, password string) (string, bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: http.MethodPost, Path: "/api/auth/login",
		JSON: map[string]string{"username": user, "password": password}})
	if err != nil {
		return "", false, h.Log.RedactError(err)
	}
	if resp.Status == http.StatusUnauthorized {
		return "", false, nil
	}
	if resp.Status != http.StatusOK {
		return "", false, fmt.Errorf("Cleanuparr login returned HTTP %d", resp.Status)
	}
	var body struct {
		RequiresTwoFactor bool `json:"requiresTwoFactor"`
		Tokens            *struct {
			AccessToken string `json:"accessToken"`
		} `json:"tokens"`
	}
	if err := resp.Decode(&body); err != nil {
		return "", false, errors.New("Cleanuparr login returned invalid data")
	}
	if body.RequiresTwoFactor {
		return "", true, nil
	}
	if body.Tokens == nil || body.Tokens.AccessToken == "" {
		return "", false, errors.New("Cleanuparr login returned no access token")
	}
	h.Log.Secret(body.Tokens.AccessToken)
	return body.Tokens.AccessToken, true, nil
}

// token signs in with the Admin login and returns the access token.
func token(ctx context.Context, h *helpers.H) (string, error) {
	token, ok, err := login(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("the Admin login cannot sign in to Cleanuparr")
	}
	if token == "" {
		return "", fmt.Errorf("%w: two-factor sign-in stops self-host from changing Cleanuparr's connections", helpers.ErrManual)
	}
	return token, nil
}

func call(ctx context.Context, h *helpers.H, method, path string, body, value any) error {
	tok, err := token(ctx, h)
	if err != nil {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: method, Path: path, JSON: body, Header: map[string]string{"Authorization": "Bearer " + tok}})
	if err != nil {
		return h.Log.RedactError(err)
	}
	if !resp.OK() {
		return fmt.Errorf("Cleanuparr %s %s returned HTTP %d", method, path, resp.Status)
	}
	if value == nil {
		return nil
	}
	if err := resp.Decode(value); err != nil {
		return fmt.Errorf("Cleanuparr %s returned invalid data", path)
	}
	return nil
}

func sameURL(a, b string) bool {
	return strings.TrimSuffix(a, "/") == strings.TrimSuffix(b, "/")
}

type entry struct {
	ID   string `json:"id"`
	URL  string `json:"url"`
	Host string `json:"host"`
}

// arrInstance finds the instance of kind that points at to, by its Compose
// service address; instances the person added for other hosts are left alone.
func arrInstance(ctx context.Context, from, to *helpers.H, kind string) (string, error) {
	var config struct {
		Instances []entry `json:"instances"`
	}
	if err := call(ctx, from, http.MethodGet, "/api/configuration/"+kind, nil, &config); err != nil {
		return "", err
	}
	for _, i := range config.Instances {
		if sameURL(i.URL, to.InternalURL()) {
			return i.ID, nil
		}
	}
	return "", nil
}

// arrLink makes Cleanuparr watch Sonarr's or Radarr's queue, reached by
// Compose service name with its API key.
func arrLink(kind, name string, version float64) app.Link {
	linked := func(ctx context.Context, from, to *helpers.H) (bool, error) {
		id, err := arrInstance(ctx, from, to, kind)
		return id != "", err
	}
	return app.NewLink("link-"+kind, kind, "clean "+name+"'s queue",
		app.LinkStep{
			Message: "connect " + name,
			Check:   linked,
			Do: func(ctx context.Context, from, to *helpers.H) error {
				return call(ctx, from, http.MethodPost, "/api/configuration/"+kind+"/instances", map[string]any{
					"enabled": true, "name": name, "url": to.InternalURL(), "apiKey": to.Secret(to.Key("api_key")), "version": version,
				}, nil)
			},
			Hint: func(from, to *helpers.H) string {
				return "Open " + from.URL + " > Settings > " + name + " and add " + to.InternalURL() + " with its API key from `self-host credentials`."
			},
		},
		&app.LinkStep{
			Message: "disconnect " + name,
			Check:   app.Absent(linked),
			Do: func(ctx context.Context, from, to *helpers.H) error {
				id, err := arrInstance(ctx, from, to, kind)
				if err != nil || id == "" {
					return err
				}
				return call(ctx, from, http.MethodDelete, "/api/configuration/"+kind+"/instances/"+id, nil, nil)
			},
			Hint: func(from, _ *helpers.H) string {
				return "Open " + from.URL + " > Settings > " + name + " and delete it."
			},
		})
}

func qbittorrentClient(ctx context.Context, from, to *helpers.H) (string, error) {
	var config struct {
		Clients []entry `json:"clients"`
	}
	if err := call(ctx, from, http.MethodGet, "/api/configuration/download_client", nil, &config); err != nil {
		return "", err
	}
	for _, c := range config.Clients {
		if sameURL(c.Host, to.InternalURL()) {
			return c.ID, nil
		}
	}
	return "", nil
}

// qbittorrentLink adds qBittorrent as Cleanuparr's download client, reached
// by its Compose service name and the Admin login.
func qbittorrentLink() app.Link {
	linked := func(ctx context.Context, from, to *helpers.H) (bool, error) {
		id, err := qbittorrentClient(ctx, from, to)
		return id != "", err
	}
	return app.NewLink("link-qbittorrent", "qbittorrent", "download client: qBittorrent",
		app.LinkStep{
			Message: "use qBittorrent as the download client",
			Check:   linked,
			Do: func(ctx context.Context, from, to *helpers.H) error {
				return call(ctx, from, http.MethodPost, "/api/configuration/download_client", map[string]any{
					"enabled": true, "name": "qBittorrent", "typeName": "qBittorrent", "host": to.InternalURL(),
					"username": from.AdminUser(), "password": from.AdminPassword(),
				}, nil)
			},
			Hint: func(from, to *helpers.H) string {
				return "Open " + from.URL + " > Settings > Download Clients and add qBittorrent at " + to.InternalURL() + " with the Admin login."
			},
		},
		&app.LinkStep{
			Message: "remove the qBittorrent download client",
			Check:   app.Absent(linked),
			Do: func(ctx context.Context, from, to *helpers.H) error {
				id, err := qbittorrentClient(ctx, from, to)
				if err != nil || id == "" {
					return err
				}
				return call(ctx, from, http.MethodDelete, "/api/configuration/download_client/"+id, nil, nil)
			},
			Hint: func(from, _ *helpers.H) string {
				return "Open " + from.URL + " > Settings > Download Clients and delete qBittorrent."
			},
		})
}
