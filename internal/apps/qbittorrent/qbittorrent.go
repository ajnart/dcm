// Package qbittorrent is the qBittorrent download client. Its WebUI starts
// with a temporary administrator password printed in the logs; Setup swaps
// it for the Admin login and points downloads at the shared folder.
package qbittorrent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

const (
	// downloadsPath is where ${DOWNLOADS_ROOT} is mounted, in qBittorrent and
	// in Sonarr and Radarr, so no remote path mapping is needed.
	downloadsPath = "/downloads"
	// torrentPort is the peer port, published for TCP and UDP.
	torrentPort = 6881
)

// App is qBittorrent from the linuxserver.io image (5.2.x at the time of
// writing). Traps from docs/qbittorrent.md: login answers 204 with a
// QBT_SID_<port> cookie, every API call needs a matching Referer, and five
// failed logins ban the caller.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "qbittorrent", Name: "qBittorrent", Category: "Downloads",
		Description:         "Download and share torrents from a clean web page",
		Image:               "lscr.io/linuxserver/qbittorrent:latest",
		Docs:                "https://github.com/qbittorrent/qBittorrent/wiki",
		Port:                8080,
		ContainerPort:       8080,
		ContainerPortIsPort: true,
		Service:             "qbittorrent",
		UsesMedia:           true,
	}
}

func (App) Inputs() []app.Input {
	return []app.Input{{Key: "torrent-port", Prompt: "Torrent peer port", Default: "6881", Help: "TCP and UDP peer port, separate from the private WebUI", HostPortProtocols: []string{"tcp", "udp"}, Validate: func(value string) error {
		port, err := strconv.Atoi(value)
		if err != nil || port < 1 || port > 65535 || strings.Trim(value, "0123456789") != "" {
			return errors.New("must be a decimal port from 1 to 65535")
		}
		return nil
	}}}
}

// Compose publishes the WebUI on the same port inside and outside the
// container, so other Apps reach it as qbittorrent:<port> and the Host header
// matches for both.
func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	torrent := strconv.Itoa(torrentPort)
	if selected := rc.Inputs["torrent-port"]; selected != "" {
		torrent = selected
	}
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
      - ${BIND_IP}:` + torrent + `:` + torrent + `
      - ${BIND_IP}:` + torrent + `:` + torrent + `/udp
    healthcheck:
      test: ["CMD-SHELL", "curl -fs -o /dev/null http://localhost:` + port + `/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

var temporaryPassword = regexp.MustCompile(`temporary password is provided for this session: (\S+)`)

var errBanned = errors.New("qBittorrent has banned this address after too many failed logins; restart the container (self-host restart qbittorrent) or wait for the ban to expire")

// login signs in; the Session keeps the cookie qBittorrent hands out, named
// SID up to 5.1 and QBT_SID_<port> since 5.2. Bad credentials give ok=false and
// no error, so callers can try the next candidate; a ban is an error.
func login(ctx context.Context, h *helpers.H, user, password string) (*helpers.Session, bool, error) {
	s := h.Session()
	resp, err := s.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/api/v2/auth/login",
		Form:   url.Values{"username": {user}, "password": {password}},
		Header: map[string]string{"Referer": h.BaseURL},
	})
	if err != nil {
		return nil, false, err
	}
	switch {
	case resp.Status == 403:
		return nil, false, errBanned
	case resp.Status == 401, resp.Status == 200 && string(resp.Body) == "Fails.":
		return nil, false, nil
	case resp.Status != 200 && resp.Status != 204:
		return nil, false, fmt.Errorf("login returned HTTP %d", resp.Status)
	}
	for _, c := range (&http.Response{Header: resp.Header}).Cookies() {
		if c.Name == "SID" || strings.HasPrefix(c.Name, "QBT_SID_") {
			return s, true, nil
		}
	}
	return nil, false, errors.New("login succeeded but qBittorrent set no session cookie")
}

func authorized(h *helpers.H, req helpers.Request) helpers.Request {
	req.Header = map[string]string{"Referer": h.BaseURL}
	return req
}

func setPreferences(ctx context.Context, h *helpers.H, s *helpers.Session, prefs map[string]string) error {
	body, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	_, err = s.Expect(ctx, authorized(h, helpers.Request{
		Method: "POST", Path: "/api/v2/app/setPreferences",
		Form: url.Values{"json": {string(body)}},
	}))
	return err
}

func adminSession(ctx context.Context, h *helpers.H) (*helpers.Session, bool, error) {
	return login(ctx, h, h.AdminUser(), h.AdminPassword())
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := h.Ready(ctx, "/"); err != nil {
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

// validCredentials applies qBittorrent's own rules (5.2.4 appcontroller.cpp)
// before anything is changed, so a rejected value never leaves it half set.
func validCredentials(user, password string) error {
	if len(user) < 3 || strings.Contains(user, ":") {
		return errors.New("qBittorrent needs a username of at least 3 characters without ':'")
	}
	if len(password) < 6 {
		return errors.New("qBittorrent needs a password of at least 6 characters")
	}
	return nil
}

// takeOver signs in as admin with the temporary password from the logs and
// sets the Admin login in one change.
func takeOver(ctx context.Context, h *helpers.H) error {
	if err := validCredentials(h.AdminUser(), h.AdminPassword()); err != nil {
		return err
	}
	logs, err := h.Logs(ctx, 1000)
	if err != nil {
		return err
	}
	found := temporaryPassword.FindAllStringSubmatch(logs, -1)
	if len(found) == 0 {
		return errors.New("no temporary password in the qBittorrent logs")
	}
	temporary := found[len(found)-1][1]
	h.Log.Secret(temporary)
	s, ok, err := login(ctx, h, "admin", temporary)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("the temporary password from the logs was refused")
	}
	return setPreferences(ctx, h, s, map[string]string{
		"web_ui_username": h.AdminUser(),
		"web_ui_password": h.AdminPassword(),
	})
}

func savePath(ctx context.Context, h *helpers.H) (bool, error) {
	s, ok, err := adminSession(ctx, h)
	if err != nil || !ok {
		return false, err
	}
	resp, err := s.Expect(ctx, authorized(h, helpers.Request{Path: "/api/v2/app/preferences"}))
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

func (App) StandaloneGuide() string {
	return "The WebUI starts with a temporary administrator password printed in the container logs; sign in with it, set your own and set the default save path to " + downloadsPath + "."
}
