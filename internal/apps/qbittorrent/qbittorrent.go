// Package qbittorrent is the qBittorrent download client. Its WebUI starts
// with a temporary administrator password printed in the logs; Setup swaps
// it for the Admin login and points downloads at the shared folder.
package qbittorrent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

const (
	// downloadsPath is where ${DOWNLOADS_ROOT} is mounted, in qBittorrent and
	// in Sonarr and Radarr, so no remote path mapping is needed.
	downloadsPath = "/downloads"
	// torrentPort is the peer port, published for TCP and UDP.
	torrentPort = 6881
	// legacyPassword is the default before qBittorrent 4.6.1.
	legacyPassword = "adminadmin"
)

type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "qbittorrent", Name: "qBittorrent", Category: "Downloads",
		Description:   "Torrent client with a web interface",
		Image:         "lscr.io/linuxserver/qbittorrent:latest",
		Docs:          "https://docs.linuxserver.io/images/docker-qbittorrent/",
		Port:          8080,
		ContainerPort: 8080,
		Service:       "qbittorrent",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }

// Compose publishes the WebUI on the same port inside and outside the
// container, so other Apps reach it as qbittorrent:<port> and the Host header
// matches for both.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	torrent := strconv.Itoa(torrentPort)
	return `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
      WEBUI_PORT: "` + port + `"
      TORRENTING_PORT: "` + torrent + `"
    volumes:
      - ./config:/config
      - ${DOWNLOADS_ROOT}:` + downloadsPath + `
    ports:
      - ${BIND_IP}:` + port + `:` + port + `
      - ` + torrent + `:` + torrent + `
      - ` + torrent + `:` + torrent + `/udp
    healthcheck:
      test: ["CMD-SHELL", "curl -fs -o /dev/null http://localhost:` + port + `/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

var temporaryPassword = regexp.MustCompile(`temporary password is provided for this session: (\S+)`)

// session is a signed-in WebUI: the SID cookie qBittorrent hands out.
type session struct{ sid string }

// login signs in; ok is false when qBittorrent answers "Fails.".
func login(ctx context.Context, h *helpers.H, user, password string) (session, bool, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/auth/login",
		Form:   url.Values{"username": {user}, "password": {password}},
		Header: map[string]string{"Referer": h.BaseURL},
	})
	if err != nil {
		return session{}, false, err
	}
	if resp.Status != 200 {
		return session{}, false, fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	sid := resp.Cookie("SID")
	return session{sid: sid}, string(resp.Body) == "Ok." && sid != "", nil
}

func (s session) request(h *helpers.H, req helpers.Request) helpers.Request {
	req.Header = map[string]string{"Referer": h.BaseURL, "Cookie": "SID=" + s.sid}
	return req
}

func setPreferences(ctx context.Context, h *helpers.H, s session, prefs map[string]string) error {
	body, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	_, err = h.Expect(ctx, s.request(h, helpers.Request{
		Method: "POST", Path: "/api/v2/app/setPreferences",
		Form: url.Values{"json": {string(body)}},
	}))
	return err
}

func adminSession(ctx context.Context, h *helpers.H) (session, bool, error) {
	return login(ctx, h, h.AdminUser(), h.AdminPassword())
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.WaitHTTP(ctx, "/", 2*time.Minute); err != nil {
		return err
	}
	err := h.Step(ctx, "admin-login", "replace the temporary password with the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) {
			_, ok, err := adminSession(ctx, h)
			return ok, err
		},
		Do: func(ctx context.Context) error { return takeOver(ctx, h) },
		Hint: "Open " + h.URL + ", sign in as admin with the temporary password from `self-host logs qbittorrent`, " +
			"then set the Admin login under Tools > Options > WebUI.",
		Credential: "admin",
	})
	if err != nil {
		return err
	}
	return h.Step(ctx, "save-path", "save downloads in "+downloadsPath, helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return savePath(ctx, h) },
		Do: func(ctx context.Context) error {
			s, ok, err := adminSession(ctx, h)
			if err != nil || !ok {
				return errors.Join(errors.New("the Admin login is refused"), err)
			}
			return setPreferences(ctx, h, s, map[string]string{"save_path": downloadsPath})
		},
		Hint:       "In qBittorrent open Tools > Options > Downloads and set Default Save Path to " + downloadsPath + ".",
		Credential: "admin",
	})
}

// takeOver signs in with the temporary password (or the pre-4.6.1 default)
// and sets the Admin login.
func takeOver(ctx context.Context, h *helpers.H) error {
	var candidates []string
	if logs, err := h.Logs(ctx, 1000); err == nil {
		if found := temporaryPassword.FindAllStringSubmatch(logs, -1); len(found) > 0 {
			candidates = append(candidates, found[len(found)-1][1])
		}
	}
	candidates = append(candidates, legacyPassword)
	for _, candidate := range candidates {
		h.Log.Secret(candidate)
		s, ok, err := login(ctx, h, "admin", candidate)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		return setPreferences(ctx, h, s, map[string]string{
			"web_ui_username": h.AdminUser(),
			"web_ui_password": h.AdminPassword(),
		})
	}
	return errors.New("neither the temporary password from the logs nor the default password was accepted")
}

func savePath(ctx context.Context, h *helpers.H) (bool, error) {
	s, ok, err := adminSession(ctx, h)
	if err != nil || !ok {
		return false, err
	}
	resp, err := h.Expect(ctx, s.request(h, helpers.Request{Path: "/api/v2/app/preferences"}))
	if err != nil {
		return false, err
	}
	var prefs struct {
		SavePath string `json:"save_path"`
	}
	if err := resp.Decode(&prefs); err != nil {
		return false, err
	}
	return prefs.SavePath == downloadsPath, nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	_, ok, err := adminSession(ctx, h)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("the Admin login %s cannot sign in to qBittorrent", h.AdminUser())
	}
	if ok, err := savePath(ctx, h); err != nil || !ok {
		return fmt.Errorf("qBittorrent does not save downloads in %s: %v", downloadsPath, err)
	}
	return nil
}

func (App) Links() []app.Link { return nil }
