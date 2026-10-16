// Package cleanuparr is Cleanuparr. Traps: docs/catalog/traps/cleanuparr.md.
package cleanuparr

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

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
func (App) Links() []app.Link   { return nil }

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
	if err := admin().Setup(ctx, h); err != nil {
		return err
	}
	return h.Step(ctx, "connections", "connect Sonarr or Radarr and a download client", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return connected(ctx, h) },
		Do: func(ctx context.Context) error {
			return fmt.Errorf("%w: Cleanuparr is connected to Sonarr, Radarr and download clients in its web UI", helpers.ErrManual)
		},
		Hint: "Open " + h.URL + " and sign in with the Admin login. Under Settings add Sonarr and Radarr (Arr Applications) and qBittorrent (Download Client); " +
			"their API keys and passwords are shown by `self-host credentials`. Then run: self-host setup cleanuparr",
		Credential: "admin",
	})
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if err := admin().Check(ctx, h); err != nil {
		return err
	}
	ok, err := connected(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Cleanuparr has no Sonarr or Radarr and no download client yet; add them in its Settings")
	}
	return nil
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

func connected(ctx context.Context, h *helpers.H) (bool, error) {
	token, ok, err := login(ctx, h, h.AdminUser(), h.AdminPassword())
	if err != nil {
		return false, err
	}
	if !ok {
		return false, errors.New("the Admin login cannot sign in to Cleanuparr")
	}
	if token == "" {
		return false, fmt.Errorf("%w: two-factor sign-in stops self-host from reading Cleanuparr's connections", helpers.ErrManual)
	}
	arrs := 0
	for _, kind := range []string{"sonarr", "radarr"} {
		var config struct {
			Instances []struct{} `json:"instances"`
		}
		if err := read(ctx, h, token, "/api/configuration/"+kind, &config); err != nil {
			return false, err
		}
		arrs += len(config.Instances)
	}
	var clients struct {
		Clients []struct{} `json:"clients"`
	}
	if err := read(ctx, h, token, "/api/configuration/download_client", &clients); err != nil {
		return false, err
	}
	return arrs > 0 && len(clients.Clients) > 0, nil
}

func read(ctx context.Context, h *helpers.H, token, path string, value any) error {
	resp, err := h.HTTP(ctx, helpers.Request{Path: path, Header: map[string]string{"Authorization": "Bearer " + token}})
	if err != nil {
		return h.Log.RedactError(err)
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("Cleanuparr %s returned HTTP %d", path, resp.Status)
	}
	if err := resp.Decode(value); err != nil {
		return fmt.Errorf("Cleanuparr %s returned invalid data", path)
	}
	return nil
}
