// Package seerr is Seerr, where people request movies and shows. Its admin
// is the Jellyfin administrator, so all of its configuration happens in
// Links: sign in to Jellyfin and enable its libraries, then add Sonarr and
// Radarr as the default servers.
package seerr

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/jellyfin"
	"github.com/ajnart/self-host/internal/helpers"
)

// mediaServerJellyfin is Seerr's mediaServerType for Jellyfin; 4 means
// none is configured yet.
const (
	mediaServerJellyfin = 2
	mediaServerNone     = 4
)

// App is Seerr (v3.x at the time of writing). Traps from docs/seerr.md:
// other Apps are reached by Compose service name, never localhost; the
// Jellyfin sign-in needs an email; requests fail unless a default server,
// quality profile and root folder are set; and Seerr refuses a second
// Jellyfin hostname once one is configured.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "seerr", Name: "Seerr", Category: "Requests",
		Description:   "Let your family ask for movies and shows to be added",
		Image:         "ghcr.io/seerr-team/seerr:latest",
		Docs:          "https://docs.seerr.dev/getting-started/docker/",
		Port:          5055,
		ContainerPort: 5055,
		Service:       "seerr",
	}
}

func (App) Inputs() []app.Input { return nil }

// Secrets pins Seerr's API key: the container adopts API_KEY on start.
func (App) Secrets() []app.SecretSpec { return []app.SecretSpec{{Name: "api_key", Length: 32}} }

// The image defaults to node (1000:1000); configured IDs keep its config
// writable when rootless Docker maps host-owned folders to container 0:0.
func (App) Compose(rc app.RenderContext) string {
	return `services:
  seerr:
    image: ghcr.io/seerr-team/seerr:latest
    init: true
    restart: unless-stopped
    user: ${PUID}:${PGID}
    environment:
      TZ: ${TZ}
      LOG_LEVEL: info
      API_KEY: ${SEERR_API_KEY}
    volumes:
      - ./config:/app/config
    ports:
      - ${BIND_IP}:` + strconv.Itoa(rc.Port) + `:5055
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:5055/api/v1/status || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
`
}

func (App) Links() []app.Link {
	return []app.Link{jellyfinLink(), serverLink(sonarr), serverLink(radarr)}
}

func keyHeader(h *helpers.H) map[string]string {
	return map[string]string{"X-Api-Key": h.Secret(h.Key("api_key"))}
}

type public struct {
	Initialized     bool `json:"initialized"`
	MediaServerType int  `json:"mediaServerType"`
}

func readPublic(ctx context.Context, h *helpers.H) (public, error) {
	var p public
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/v1/settings/public"})
	if err != nil {
		return p, err
	}
	return p, resp.Decode(&p)
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	return h.Ready(ctx, "/api/v1/status")
}

// Check proves Seerr answers; whether it is connected is the Links' job.
func (App) Check(ctx context.Context, h *helpers.H) error {
	_, err := readPublic(ctx, h)
	return err
}

// signIn signs in to Seerr with the Jellyfin Admin login. The first time it
// also binds Jellyfin (by service name) and creates Seerr's admin.
func signIn(ctx context.Context, from *helpers.H, p public) (string, error) {
	body := map[string]any{"username": from.AdminUser(), "password": from.AdminPassword()}
	if p.MediaServerType == mediaServerNone {
		body["hostname"], body["port"], body["useSsl"], body["urlBase"] = "jellyfin", jellyfin.ContainerPort, false, ""
		body["serverType"], body["email"] = mediaServerJellyfin, from.AdminUser()+"@selfhost.local"
	}
	resp, err := from.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/v1/auth/jellyfin", JSON: body})
	if err != nil {
		return "", err
	}
	if !resp.OK() {
		return "", fmt.Errorf("Jellyfin sign-in returned HTTP %d: %s", resp.Status, strings.TrimSpace(string(resp.Body)))
	}
	cookie := resp.Cookie("connect.sid")
	if cookie == "" {
		return "", errors.New("Seerr set no session cookie")
	}
	return "connect.sid=" + cookie, nil
}

type jellyfinLibrary struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

func syncLibraries(ctx context.Context, h *helpers.H) ([]jellyfinLibrary, error) {
	resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/v1/settings/jellyfin/library/sync", Header: keyHeader(h)})
	if err != nil {
		return nil, err
	}
	if resp.Status == 404 {
		return nil, errors.New("Jellyfin has no libraries yet")
	}
	if !resp.OK() {
		return nil, fmt.Errorf("library sync returned HTTP %d", resp.Status)
	}
	var libs []jellyfinLibrary
	return libs, resp.Decode(&libs)
}

func listLibraries(ctx context.Context, h *helpers.H) ([]jellyfinLibrary, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/v1/settings/jellyfin/library", Header: keyHeader(h)})
	if err != nil {
		return nil, err
	}
	var libs []jellyfinLibrary
	return libs, resp.Decode(&libs)
}

// connected reports whether Seerr is set up on Jellyfin with every Jellyfin
// library enabled.
func connected(ctx context.Context, h *helpers.H) (bool, error) {
	p, err := readPublic(ctx, h)
	if err != nil || !p.Initialized || p.MediaServerType != mediaServerJellyfin {
		return false, err
	}
	libs, err := listLibraries(ctx, h)
	if err != nil || len(libs) == 0 {
		return false, err
	}
	for _, l := range libs {
		if !l.Enabled {
			return false, nil
		}
	}
	return true, nil
}

func connect(ctx context.Context, from *helpers.H) error {
	p, err := readPublic(ctx, from)
	if err != nil {
		return err
	}
	if p.MediaServerType != mediaServerNone && p.MediaServerType != mediaServerJellyfin {
		return errors.New("Seerr is already set up with another media server; it is left as it is")
	}
	cookie, err := signIn(ctx, from, p)
	if err != nil {
		return err
	}
	libs, err := syncLibraries(ctx, from)
	if err != nil {
		return err
	}
	for _, l := range libs {
		if l.Enabled {
			continue
		}
		if _, err := from.Expect(ctx, helpers.Request{
			Method: "PUT", Path: "/api/v1/settings/jellyfin/library/" + l.ID, Header: keyHeader(from),
			JSON: map[string]bool{"enabled": true},
		}); err != nil {
			return err
		}
	}
	if p.Initialized {
		return nil
	}
	_, err = from.Expect(ctx, helpers.Request{Method: "POST", Path: "/api/v1/settings/initialize", Header: map[string]string{"Cookie": cookie}})
	return err
}

// jellyfinLink signs Seerr in to Jellyfin with the Admin login, enables every
// Jellyfin library and finishes Seerr's setup.
func jellyfinLink() app.Link {
	const id = "link-jellyfin"
	return app.Link{
		ID:     id,
		Target: "jellyfin",
		Title:  "media server: Jellyfin",
		Apply: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, id, "sign in to Jellyfin and enable its libraries", helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) { return connected(ctx, from) },
				Do:    func(ctx context.Context) error { return connect(ctx, from) },
				Hint: "Open " + from.URL + "/setup: choose Jellyfin, server jellyfin port " + strconv.Itoa(jellyfin.ContainerPort) +
					", sign in with the Admin login (any email), enable every library and finish.",
				Credential: "admin",
			})
		},
	}
}

// server is Sonarr or Radarr as Seerr sees them.
type server struct {
	id, name string
	port     int
	// rootFolder is the library folder the server's own Setup registers.
	rootFolder string
	// extra holds the fields only this kind of server takes.
	extra map[string]any
}

var (
	sonarr = server{id: "sonarr", name: "Sonarr", port: 8989, rootFolder: "/media/tv", extra: map[string]any{
		"enableSeasonFolders": true, "seriesType": "standard", "animeSeriesType": "standard",
		"animeTags": []any{}, "monitorNewItems": "all",
	}}
	radarr = server{id: "radarr", name: "Radarr", port: 7878, rootFolder: "/media/movies", extra: map[string]any{
		"minimumAvailability": "released",
	}}
)

func (s server) points(item map[string]any) bool {
	port, _ := item["port"].(float64)
	return item["hostname"] == s.id && int(port) == s.port
}

func (s server) list(ctx context.Context, h *helpers.H) ([]map[string]any, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/api/v1/settings/" + s.id, Header: keyHeader(h)})
	if err != nil {
		return nil, err
	}
	var items []map[string]any
	return items, resp.Decode(&items)
}

func (s server) linked(ctx context.Context, h *helpers.H) (bool, error) {
	items, err := s.list(ctx, h)
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if s.points(item) {
			return true, nil
		}
	}
	return false, nil
}

type testResult struct {
	Profiles []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"profiles"`
	RootFolders []struct {
		Path string `json:"path"`
	} `json:"rootFolders"`
}

// add tests the connection, then saves the server as the default with its
// first quality profile and the root folder the server's Setup made.
func (s server) add(ctx context.Context, from, to *helpers.H) error {
	p, err := readPublic(ctx, from)
	if err != nil {
		return err
	}
	if !p.Initialized {
		return errors.New("Seerr is not connected to Jellyfin yet (see link-jellyfin)")
	}
	conn := map[string]any{"hostname": s.id, "port": s.port, "apiKey": to.Secret(to.Key("api_key")), "useSsl": false, "baseUrl": ""}
	resp, err := from.HTTP(ctx, helpers.Request{Method: "POST", Path: "/api/v1/settings/" + s.id + "/test", Header: keyHeader(from), JSON: conn})
	if err != nil {
		return err
	}
	if !resp.OK() {
		return fmt.Errorf("Seerr cannot reach %s at http://%s:%d (HTTP %d)", s.name, s.id, s.port, resp.Status)
	}
	var test testResult
	if err := resp.Decode(&test); err != nil {
		return err
	}
	if len(test.Profiles) == 0 {
		return fmt.Errorf("%s has no quality profile", s.name)
	}
	folder := ""
	for _, f := range test.RootFolders {
		if f.Path == s.rootFolder {
			folder = f.Path
		}
	}
	if folder == "" {
		return fmt.Errorf("%s has no root folder %s", s.name, s.rootFolder)
	}
	body := map[string]any{
		"name": s.name, "activeProfileId": test.Profiles[0].ID, "activeProfileName": test.Profiles[0].Name,
		"activeDirectory": folder, "is4k": false, "isDefault": true, "syncEnabled": false, "preventSearch": false,
		"tagRequests": false, "tags": []any{}, "overrideRule": []any{},
	}
	for k, v := range conn {
		body[k] = v
	}
	for k, v := range s.extra {
		body[k] = v
	}
	_, err = from.Expect(ctx, helpers.Request{Method: "POST", Path: "/api/v1/settings/" + s.id, Header: keyHeader(from), JSON: body})
	return err
}

func (s server) remove(ctx context.Context, h *helpers.H) error {
	items, err := s.list(ctx, h)
	if err != nil {
		return err
	}
	for _, item := range items {
		if !s.points(item) {
			continue
		}
		id, _ := item["id"].(float64)
		if _, err := h.Expect(ctx, helpers.Request{Method: "DELETE", Path: fmt.Sprintf("/api/v1/settings/%s/%d", s.id, int(id)), Header: keyHeader(h)}); err != nil {
			return err
		}
	}
	return nil
}

// serverLink makes Sonarr or Radarr the default server Seerr sends requests
// to, reached by Compose service name with its API key.
func serverLink(s server) app.Link {
	id := "link-" + s.id
	hint := func(from *helpers.H) string {
		return "Open " + from.URL + "/settings/services, add " + s.name + " with host " + s.id + ", port " + strconv.Itoa(s.port) +
			", its API key from `self-host credentials`, the first quality profile and root folder " + s.rootFolder + ", marked default."
	}
	return app.Link{
		ID:     id,
		Target: s.id,
		Title:  "requests go to " + s.name,
		Apply: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, id, "send requests to "+s.name, helpers.StepSpec{
				Check:      func(ctx context.Context) (bool, error) { return s.linked(ctx, from) },
				Do:         func(ctx context.Context) error { return s.add(ctx, from, to) },
				Hint:       hint(from),
				Credential: "admin",
			})
		},
		Remove: func(ctx context.Context, from, to *helpers.H) error {
			return from.Step(ctx, "un"+id, "stop sending requests to "+s.name, helpers.StepSpec{
				Check: func(ctx context.Context) (bool, error) {
					found, err := s.linked(ctx, from)
					return !found, err
				},
				Do:         func(ctx context.Context) error { return s.remove(ctx, from) },
				Hint:       "Open " + from.URL + "/settings/services and delete " + s.name + ".",
				Credential: "admin",
			})
		},
	}
}
