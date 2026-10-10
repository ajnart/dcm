// Package jellyfin is the Jellyfin media server. Setup finishes the startup
// wizard headlessly with the Admin login, creates an API key for the other
// Apps and adds a library for each media folder.
package jellyfin

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

// ContainerPort is where other Apps reach Jellyfin: http://jellyfin:8096.
const ContainerPort = 8096

// apiKeyApp names the API key Setup creates under Dashboard › API Keys.
const apiKeyApp = "selfhost"

// App is Jellyfin from the linuxserver.io image (12.x at the time of
// writing). Traps from docs/jellyfin.md: /System/Info/Public reports the
// wizard unfinished while the server still boots, POST /Startup/User 404s
// unless GET /Startup/User ran first, creating an existing library name makes
// "Movies2", and 12.x only accepts the `Authorization: MediaBrowser` header.
type App struct{}

func (App) Info() app.Info {
	return app.Info{
		ID: "jellyfin", Name: "Jellyfin", Category: "Media",
		Description:   "Stream your movies and shows to every screen in the house",
		Image:         "lscr.io/linuxserver/jellyfin:latest",
		Docs:          "https://jellyfin.org/docs/general/installation/container/",
		Port:          8096,
		ContainerPort: ContainerPort,
		WebSockets:    true,
		Service:       "jellyfin",
		UsesMedia:     true,
	}
}

func (App) Inputs() []app.Input { return nil }
func (App) Links() []app.Link   { return nil }

func (App) Compose(rc app.RenderContext) string {
	port := strconv.Itoa(rc.Port)
	return `services:
  jellyfin:
    image: lscr.io/linuxserver/jellyfin:latest
    restart: unless-stopped
    environment:
      PUID: ${PUID}
      PGID: ${PGID}
      TZ: ${TZ}
      UMASK: ${UMASK}
      JELLYFIN_PublishedServerUrl: http://${LAN_IP}:` + port + `
    volumes:
      - ./config:/config
      - ${MEDIA_ROOT}:/media
    ports:
      - ${BIND_IP}:` + port + `:8096
    healthcheck:
      test: ["CMD-SHELL", "curl -fs -o /dev/null http://localhost:8096/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
`
}

// library is one media folder Setup offers as a Jellyfin library.
type library struct {
	name, folder, collectionType string
	// always means the folder is created when missing: Sonarr and Radarr
	// file into it.
	always bool
}

var libraries = []library{
	{name: "Movies", folder: "movies", collectionType: "movies", always: true},
	{name: "Shows", folder: "tv", collectionType: "tvshows", always: true},
	{name: "Music", folder: "music", collectionType: "music"},
	{name: "Books", folder: "books", collectionType: "books"},
}

func (l library) path() string { return "/media/" + l.folder }

// authorization is the header Jellyfin 10.9 through 12 accept; token is a
// session token or an API key, or "" before signing in.
func authorization(token string) map[string]string {
	value := `MediaBrowser Client="selfhost", Device="selfhost-cli", DeviceId="selfhost-cli", Version="1.0.0"`
	if token != "" {
		value += `, Token="` + token + `"`
	}
	return map[string]string{"Authorization": value}
}

type publicInfo struct {
	Version                string
	StartupWizardCompleted bool
}

func readPublicInfo(ctx context.Context, h *helpers.H) (publicInfo, error) {
	var info publicInfo
	resp, err := h.Expect(ctx, helpers.Request{Path: "/System/Info/Public"})
	if err != nil {
		return info, err
	}
	return info, resp.Decode(&info)
}

// waitReady waits for the real server: while Jellyfin boots or migrates, a
// placeholder answers /System/Info/Public (reporting the wizard unfinished,
// sometimes without a Version) and every other path with 503. A second path
// tells the two apart: the real server answers /Startup/Configuration with
// 200 before the wizard and 401 after it.
func waitReady(ctx context.Context, h *helpers.H) error {
	return h.Poll(ctx, 3*time.Minute, func(ctx context.Context) (bool, error) {
		info, err := readPublicInfo(ctx, h)
		if err != nil {
			return false, err
		}
		if info.Version == "" {
			return false, errors.New("Jellyfin is still starting")
		}
		resp, err := h.HTTP(ctx, helpers.Request{Path: "/Startup/Configuration"})
		if err != nil {
			return false, err
		}
		if resp.Status == 503 {
			return false, errors.New("Jellyfin is still starting")
		}
		return true, nil
	})
}

func wizardDone(ctx context.Context, h *helpers.H) (bool, error) {
	info, err := readPublicInfo(ctx, h)
	return info.StartupWizardCompleted, err
}

// runWizard posts what the web wizard posts, in its order.
func runWizard(ctx context.Context, h *helpers.H) error {
	if _, err := h.Expect(ctx, helpers.Request{Method: "POST", Path: "/Startup/Configuration", JSON: map[string]string{
		"UICulture": "en-US", "MetadataCountryCode": "US", "PreferredMetadataLanguage": "en",
	}}); err != nil {
		return err
	}
	// GET creates the placeholder first user that POST then renames.
	if _, err := h.Expect(ctx, helpers.Request{Path: "/Startup/User"}); err != nil {
		return err
	}
	resp, err := h.HTTP(ctx, helpers.Request{Method: "POST", Path: "/Startup/User", JSON: map[string]string{
		"Name": h.AdminUser(), "Password": h.AdminPassword(),
	}})
	if err != nil {
		return err
	}
	// 403: an earlier run already set the password; sign-in proves it below.
	if !resp.OK() && resp.Status != 403 {
		return fmt.Errorf("POST /Startup/User returned HTTP %d", resp.Status)
	}
	if _, err := h.Expect(ctx, helpers.Request{Method: "POST", Path: "/Startup/RemoteAccess", JSON: map[string]bool{
		"EnableRemoteAccess": true, "EnableAutomaticPortMapping": false,
	}}); err != nil {
		return err
	}
	_, err = h.Expect(ctx, helpers.Request{Method: "POST", Path: "/Startup/Complete"})
	return err
}

type authResult struct {
	AccessToken string
	User        struct {
		Policy struct{ IsAdministrator bool }
	}
}

// signIn returns a session token for the Admin login, or "" when Jellyfin
// rejects it.
func signIn(ctx context.Context, h *helpers.H) (string, error) {
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: "POST", Path: "/Users/AuthenticateByName", Header: authorization(""),
		JSON: map[string]string{"Username": h.AdminUser(), "Pw": h.AdminPassword()},
	})
	if err != nil {
		return "", err
	}
	if resp.Status == 401 {
		return "", nil
	}
	if !resp.OK() {
		return "", fmt.Errorf("sign-in returned HTTP %d", resp.Status)
	}
	var result authResult
	if err := resp.Decode(&result); err != nil {
		return "", err
	}
	if !result.User.Policy.IsAdministrator {
		return "", fmt.Errorf("%s is not a Jellyfin administrator", h.AdminUser())
	}
	return result.AccessToken, nil
}

// session signs in once per run; Jellyfin may lock out repeated failures.
func session(ctx context.Context, h *helpers.H) (string, error) {
	return h.Remember("jellyfin-session", func() (string, error) {
		token, err := signIn(ctx, h)
		if err == nil && token == "" {
			err = fmt.Errorf("the Admin login %s cannot sign in to Jellyfin", h.AdminUser())
		}
		return token, err
	})
}

// APIKey is the stored key other Apps use to call Jellyfin.
func APIKey(h *helpers.H) string { return h.Secret(h.Key("api_key")) }

func keyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	key := APIKey(h)
	if key == "" {
		return false, nil
	}
	resp, err := h.HTTP(ctx, helpers.Request{Path: "/System/Info", Header: authorization(key)})
	return err == nil && resp.Status == 200, err
}

type apiKeys struct {
	Items []struct {
		AccessToken string
		AppName     string
	}
}

// findKey returns the last key named apiKeyApp, or "".
func findKey(ctx context.Context, h *helpers.H, token string) (string, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/Auth/Keys", Header: authorization(token)})
	if err != nil {
		return "", err
	}
	var keys apiKeys
	if err := resp.Decode(&keys); err != nil {
		return "", err
	}
	found := ""
	for _, item := range keys.Items {
		if item.AppName == apiKeyApp {
			found = item.AccessToken
		}
	}
	return found, nil
}

// createKey reuses the selfhost key when it exists: POST answers 204 with no
// body and never refuses a duplicate name.
func createKey(ctx context.Context, h *helpers.H) error {
	token, err := session(ctx, h)
	if err != nil {
		return err
	}
	key, err := findKey(ctx, h, token)
	if err != nil {
		return err
	}
	if key == "" {
		if _, err := h.Expect(ctx, helpers.Request{Method: "POST", Path: "/Auth/Keys?app=" + apiKeyApp, Header: authorization(token)}); err != nil {
			return err
		}
		if key, err = findKey(ctx, h, token); err != nil {
			return err
		}
	}
	if key == "" {
		return errors.New("Jellyfin did not list the new API key")
	}
	return h.SetSecret(h.Key("api_key"), key)
}

type virtualFolder struct {
	Name      string
	Locations []string
}

func virtualFolders(ctx context.Context, h *helpers.H) ([]virtualFolder, error) {
	resp, err := h.Expect(ctx, helpers.Request{Path: "/Library/VirtualFolders", Header: authorization(APIKey(h))})
	if err != nil {
		return nil, err
	}
	var folders []virtualFolder
	return folders, resp.Decode(&folders)
}

func hasLibrary(ctx context.Context, h *helpers.H, l library) (bool, error) {
	folders, err := virtualFolders(ctx, h)
	if err != nil {
		return false, err
	}
	for _, f := range folders {
		if f.Name == l.name {
			return true, nil
		}
	}
	return false, nil
}

func addLibrary(ctx context.Context, h *helpers.H, l library) error {
	if _, err := h.Exec(ctx, nil, "s6-setuidgid", "abc", "mkdir", "-p", l.path()); err != nil {
		return err
	}
	query := url.Values{"name": {l.name}, "collectionType": {l.collectionType}, "paths": {l.path()}, "refreshLibrary": {"true"}}
	_, err := h.Expect(ctx, helpers.Request{
		Method: "POST", Path: "/Library/VirtualFolders?" + query.Encode(), Header: authorization(APIKey(h)),
		JSON: map[string]any{"LibraryOptions": map[string]any{"PathInfos": []map[string]string{{"Path": l.path()}}}},
	})
	return err
}

// wanted lists the libraries for this host: Movies and Shows always, the
// others when their folder exists under the media folder.
func wanted(h *helpers.H) []library {
	var out []library
	for _, l := range libraries {
		if l.always {
			out = append(out, l)
			continue
		}
		if info, err := os.Stat(filepath.Join(h.Settings["MEDIA_ROOT"], l.folder)); err == nil && info.IsDir() {
			out = append(out, l)
		}
	}
	return out
}

func (App) Setup(ctx context.Context, h *helpers.H) error {
	if err := waitReady(ctx, h); err != nil {
		return err
	}
	err := h.Step(ctx, "wizard", "finish the startup wizard with the Admin login", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return wizardDone(ctx, h) },
		Do:    func(ctx context.Context) error { return runWizard(ctx, h) },
		Hint: "Open " + h.URL + " and finish the setup wizard: create the administrator " + h.AdminUser() +
			" with the password shown by `self-host credentials`, then run: self-host setup jellyfin",
		Credential: "admin",
	})
	if err != nil {
		return err
	}
	err = h.Step(ctx, "api-key", "create the "+apiKeyApp+" API key", helpers.StepSpec{
		Check: func(ctx context.Context) (bool, error) { return keyWorks(ctx, h) },
		Do:    func(ctx context.Context) error { return createKey(ctx, h) },
		Hint: "Open " + h.URL + "/web/#/dashboard/keys, add a key named " + apiKeyApp +
			" and save it in secrets.env as " + h.Key("api_key") + ".",
		Credential: "admin",
	})
	if err != nil {
		return err
	}
	for _, l := range wanted(h) {
		err := h.Step(ctx, "library-"+l.folder, "add the "+l.name+" library ("+l.path()+")", helpers.StepSpec{
			Check: func(ctx context.Context) (bool, error) { return hasLibrary(ctx, h, l) },
			Do:    func(ctx context.Context) error { return addLibrary(ctx, h, l) },
			Hint: "Open " + h.URL + "/web/#/dashboard/libraries > Add Media Library: " + l.name +
				", folder " + l.path() + ".",
			Credential: "admin",
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (App) Check(ctx context.Context, h *helpers.H) error {
	if token, err := signIn(ctx, h); token == "" {
		return fmt.Errorf("the Admin login %s cannot sign in to Jellyfin: %v", h.AdminUser(), err)
	}
	if ok, err := keyWorks(ctx, h); !ok {
		return fmt.Errorf("the Jellyfin API key is not accepted: %v", err)
	}
	return nil
}
