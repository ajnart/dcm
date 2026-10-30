// Package cleanuparr is Cleanuparr. Traps: docs/catalog/traps/cleanuparr.md.
package cleanuparr

import (
	"context"
	"encoding/json"
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
		Image:         "ghcr.io/cleanuparr/cleanuparr:latest",
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

func (App) StandaloneGuide() string {
	return "After the first start, create the account on the first visit."
}

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  cleanuparr:
    image: ghcr.io/cleanuparr/cleanuparr:latest
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

// owned is the entries under key of the list at path that point at to by
// its Compose service address, deleted under collection; entries the person
// added for other hosts are left alone.
func owned(path, key, collection string) app.Owned {
	return app.Owned{
		Find: func(ctx context.Context, from, to *helpers.H) ([]string, error) {
			var config map[string]json.RawMessage
			if err := call(ctx, from, http.MethodGet, path, nil, &config); err != nil {
				return nil, err
			}
			var entries []entry
			if raw, found := config[key]; found {
				if err := json.Unmarshal(raw, &entries); err != nil {
					return nil, fmt.Errorf("Cleanuparr %s returned an invalid %s list", path, key)
				}
			}
			var ids []string
			for _, e := range entries {
				if sameURL(e.URL, to.InternalURL()) || sameURL(e.Host, to.InternalURL()) {
					ids = append(ids, e.ID)
				}
			}
			return ids, nil
		},
		Delete: func(ctx context.Context, from, _ *helpers.H, id string) error {
			return call(ctx, from, http.MethodDelete, collection+"/"+id, nil, nil)
		},
	}
}

// arrLink makes Cleanuparr watch Sonarr's or Radarr's queue, reached by
// Compose service name with its API key.
func arrLink(kind, name string, version float64) app.Link {
	path := "/api/configuration/" + kind
	return app.NewOwnedLink("link-"+kind, kind, "clean "+name+"'s queue", owned(path, "instances", path+"/instances"),
		app.LinkStep{
			Message: "connect " + name,
			Do: func(ctx context.Context, from, to *helpers.H) error {
				return call(ctx, from, http.MethodPost, path+"/instances", map[string]any{
					"enabled": true, "name": name, "url": to.InternalURL(), "apiKey": to.Secret(to.Key("api_key")), "version": version,
				}, nil)
			},
			Hint: func(from, to *helpers.H) string {
				return "Open " + from.URL + " > Settings > " + name + " and add " + to.InternalURL() + " with its API key from `self-host credentials`."
			},
		},
		app.LinkStep{
			Message: "disconnect " + name,
			Hint: func(from, _ *helpers.H) string {
				return "Open " + from.URL + " > Settings > " + name + " and delete it."
			},
		})
}

// qbittorrentLink adds qBittorrent as Cleanuparr's download client, reached
// by its Compose service name and the Admin login.
func qbittorrentLink() app.Link {
	const path = "/api/configuration/download_client"
	return app.NewOwnedLink("link-qbittorrent", "qbittorrent", "download client: qBittorrent", owned(path, "clients", path),
		app.LinkStep{
			Message: "use qBittorrent as the download client",
			Do: func(ctx context.Context, from, to *helpers.H) error {
				return call(ctx, from, http.MethodPost, path, map[string]any{
					"enabled": true, "name": "qBittorrent", "typeName": "qBittorrent", "host": to.InternalURL(),
					"username": from.AdminUser(), "password": from.AdminPassword(),
				}, nil)
			},
			Hint: func(from, to *helpers.H) string {
				return "Open " + from.URL + " > Settings > Download Clients and add qBittorrent at " + to.InternalURL() + " with the Admin login."
			},
		},
		app.LinkStep{
			Message: "remove the qBittorrent download client",
			Hint: func(from, _ *helpers.H) string {
				return "Open " + from.URL + " > Settings > Download Clients and delete qBittorrent."
			},
		})
}
