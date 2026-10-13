package arr_test

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/systemtest"
)

func newEnv(t *testing.T, apps ...app.App) *arrtest.Env {
	return arrtest.New(t, catalog.New(apps, nil))
}

func adminLogin(t *testing.T, e *arrtest.Env) (string, string) {
	creds := e.Run("credentials", "--json")
	var parsed struct {
		Admin struct{ Username, Password string }
	}
	if err := json.Unmarshal([]byte(creds.Out), &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed.Admin.Username, parsed.Admin.Password
}

func secrets(t *testing.T, e *arrtest.Env) string {
	return clitest.Read(t, filepath.Join(clitest.Root(t, e.Deps), "secrets.env"))
}

func TestSonarrInstallSetsUpFormsLoginApiKeyAndRootFolder(t *testing.T) {
	e := newEnv(t, arr.Sonarr())

	r := e.Run("install", "sonarr", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	user, pass := adminLogin(t, e)
	method, gotUser := e.Sonarr.Auth()
	if method != "forms" || gotUser != user || e.Sonarr.Password() != pass {
		t.Errorf("auth is %s/%s, want forms with the Admin login %s", method, gotUser, user)
	}
	if !strings.Contains(secrets(t, e), "SONARR_API_KEY="+e.Sonarr.Key) {
		t.Errorf("secrets.env lacks the Sonarr API key:\n%s", secrets(t, e))
	}
	if folders := e.Sonarr.RootFolders(); len(folders) != 1 || folders[0] != "/media/tv" {
		t.Errorf("root folders %v, want [/media/tv]", folders)
	}
	for _, step := range []string{"api-key", "auth", "root-folder", "check"} {
		if r.StepEvent("sonarr", step) != "step.ok" {
			t.Errorf("step %s not ok:\n%s", step, r.Out)
		}
	}
}

func TestSonarrFragmentUsesLinuxserverImageAndHostSettings(t *testing.T) {
	e := newEnv(t, arr.Sonarr())
	e.Run("install", "sonarr", "--yes")

	fragment := clitest.Read(t, filepath.Join(e.AppDir("sonarr"), "compose.yml"))

	for _, want := range []string{
		"image: lscr.io/linuxserver/sonarr:latest",
		"PUID: ${PUID}", "PGID: ${PGID}", "TZ: ${TZ}", "UMASK: ${UMASK}",
		"${BIND_IP}:" + e.Port("sonarr") + ":8989",
		"./config:/config",
		"${MEDIA_ROOT}:/media",
		"${DOWNLOADS_ROOT}:/downloads",
	} {
		if !strings.Contains(fragment, want) {
			t.Errorf("fragment lacks %q:\n%s", want, fragment)
		}
	}
}

func TestSonarrSetupRerunSkipsEveryStep(t *testing.T) {
	e := newEnv(t, arr.Sonarr())
	e.Run("install", "sonarr", "--yes")

	r := e.Run("setup", "sonarr", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	for _, step := range []string{"api-key", "auth", "root-folder"} {
		if r.StepEvent("sonarr", step) != "step.skip" {
			t.Errorf("step %s should skip:\n%s", step, r.Out)
		}
	}
}

func TestSonarrAndRadarrDownloadClientLinkToQBittorrent(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), arr.Radarr(), qbittorrent.App{})

	r := e.Run("install", "sonarr", "radarr", "qbittorrent", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	user, pass := adminLogin(t, e)
	for _, c := range []struct {
		arr      *arrtest.Arr
		id       string
		category string
		value    string
	}{{e.Sonarr, "sonarr", "tvCategory", "tv"}, {e.Radarr, "radarr", "movieCategory", "movies"}} {
		clients := c.arr.DownloadClients()
		if len(clients) != 1 {
			t.Fatalf("%s has %d download clients, want 1\n%s", c.id, len(clients), r.Out)
		}
		client := clients[0]
		want := map[string]any{"host": "qbittorrent", "port": float64(mustPort(t, e.Port("qbittorrent"))),
			"username": user, "password": pass, c.category: c.value}
		for name, value := range want {
			if got := arrtest.Field(client, name); got != value {
				t.Errorf("%s download client field %s = %v, want %v", c.id, name, got, value)
			}
		}
		if client["implementation"] != "QBittorrent" || client["name"] != "qBittorrent" || client["enable"] != true {
			t.Errorf("%s download client is %v", c.id, client)
		}
		if r.StepEvent(c.id, "link-qbittorrent") != "step.ok" {
			t.Errorf("%s link-qbittorrent not ok:\n%s", c.id, r.Out)
		}
	}
}

func TestLinkIsNotScheduledWhileQBittorrentIsMissing(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})

	r := e.Run("install", "sonarr", "--yes", "--json")

	if r.Code != 0 || len(e.Sonarr.DownloadClients()) != 0 || r.StepEvent("sonarr", "link-qbittorrent") != "" {
		t.Fatalf("no Link should run without qBittorrent (exit %d)\n%s", r.Code, r.Out)
	}
}

func TestInstallingQBittorrentLaterRunsTheLinkPointingAtIt(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})
	e.Run("install", "sonarr", "--yes")

	r := e.Run("install", "qbittorrent", "--yes", "--json")

	if r.Code != 0 || len(e.Sonarr.DownloadClients()) != 1 {
		t.Fatalf("Sonarr should be linked once qBittorrent is installed (exit %d)\n%s", r.Code, r.Out)
	}
}

func TestSetupRerunSkipsEveryLink(t *testing.T) {
	e := newEnv(t, arr.Sonarr(), qbittorrent.App{})
	e.Run("install", "sonarr", "qbittorrent", "--yes")

	r := e.Run("setup", "--json")

	if r.Code != 0 || len(e.Sonarr.DownloadClients()) != 1 {
		t.Fatalf("exit %d, download clients %d\n%s", r.Code, len(e.Sonarr.DownloadClients()), r.Out)
	}
	if r.StepEvent("sonarr", "link-qbittorrent") != "step.skip" {
		t.Errorf("link should skip:\n%s", r.Out)
	}
}

func mustPort(t *testing.T, s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func applicationNames(e *arrtest.Env) []string {
	var names []string
	for _, application := range e.Prowlarr.Applications() {
		names = append(names, application["implementation"].(string))
	}
	slices.Sort(names)
	return names
}

func TestMediaRecipeInstallsAndWiresEverything(t *testing.T) {
	e := arrtest.New(t, catalog.Default())

	r := e.Run("install", "media", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if names := applicationNames(e); !slices.Equal(names, []string{"Radarr", "Sonarr"}) {
		t.Errorf("Prowlarr applications %v, want Radarr and Sonarr", names)
	}
	application := e.Prowlarr.Applications()[0]
	if arrtest.Field(application, "prowlarrUrl") != "http://prowlarr:9696" || application["syncLevel"] != "fullSync" {
		t.Errorf("application %v", application)
	}
	if len(e.Sonarr.DownloadClients()) != 1 || len(e.Radarr.DownloadClients()) != 1 {
		t.Errorf("download clients: sonarr %d, radarr %d", len(e.Sonarr.DownloadClients()), len(e.Radarr.DownloadClients()))
	}
	for _, link := range [][2]string{{"prowlarr", "link-sonarr"}, {"prowlarr", "link-radarr"}, {"sonarr", "link-qbittorrent"}, {"radarr", "link-qbittorrent"}} {
		if r.StepEvent(link[0], link[1]) != "step.ok" {
			t.Errorf("%s %s not ok:\n%s", link[0], link[1], r.Out)
		}
	}
	for _, image := range []string{"prowlarr", "radarr", "sonarr", "qbittorrent"} {
		fragment := clitest.Read(t, filepath.Join(e.AppDir(image), "compose.yml"))
		if !strings.Contains(fragment, "image: lscr.io/linuxserver/"+image+":latest") {
			t.Errorf("%s fragment:\n%s", image, fragment)
		}
	}
}

func TestSecondSetupSkipsEveryStepExceptWaitAndCheck(t *testing.T) {
	e := arrtest.New(t, catalog.Default())
	e.Run("install", "media", "--yes")

	r := e.Run("setup", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	steps := 0
	for _, event := range r.Events {
		step, _ := event["step"].(string)
		if event["app"] == nil || event["event"] == "step.start" || step == "ready" || step == "check" {
			continue
		}
		steps++
		if event["event"] != "step.skip" {
			t.Errorf("%s %s: %v, want step.skip", event["app"], step, event["event"])
		}
	}
	if steps == 0 {
		t.Fatalf("no steps seen:\n%s", r.Out)
	}
	if len(e.Sonarr.DownloadClients()) != 1 || len(e.Prowlarr.Applications()) != 2 {
		t.Errorf("Links were duplicated")
	}
}

func TestInstallingRadarrLaterRunsOnlyRadarrLinks(t *testing.T) {
	e := arrtest.New(t, catalog.Default())
	e.Run("install", "prowlarr", "sonarr", "qbittorrent", "--yes")

	r := e.Run("install", "radarr", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if names := applicationNames(e); !slices.Equal(names, []string{"Radarr", "Sonarr"}) {
		t.Errorf("Prowlarr applications %v", names)
	}
	if len(e.Radarr.DownloadClients()) != 1 || len(e.Sonarr.DownloadClients()) != 1 {
		t.Errorf("download clients: radarr %d, sonarr %d (Sonarr must stay at 1)", len(e.Radarr.DownloadClients()), len(e.Sonarr.DownloadClients()))
	}
	if r.Step("sonarr", "link-qbittorrent") != nil || r.Step("prowlarr", "link-sonarr") != nil {
		t.Errorf("Links of other Apps must not run:\n%s", r.Out)
	}
}

func TestRemovingSonarrRemovesItFromProwlarr(t *testing.T) {
	e := arrtest.New(t, catalog.Default())
	e.Run("install", "media", "--yes")

	r := e.Run("remove", "sonarr", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if names := applicationNames(e); !slices.Equal(names, []string{"Radarr"}) {
		t.Errorf("Prowlarr applications %v, want only Radarr", names)
	}
	if r.StepEvent("prowlarr", "unlink-sonarr") != "step.ok" {
		t.Errorf("unlink not reported:\n%s", r.Out)
	}
	if status := e.Run("status", "--json"); strings.Contains(status.Out, `"link-sonarr"`) {
		t.Errorf("status still shows the removed Link:\n%s", status.Out)
	}
}

func TestRemovingQBittorrentRemovesTheDownloadClients(t *testing.T) {
	e := arrtest.New(t, catalog.Default())
	e.Run("install", "media", "--yes")

	r := e.Run("remove", "qbittorrent", "--yes", "--json")

	if r.Code != 0 || len(e.Sonarr.DownloadClients()) != 0 || len(e.Radarr.DownloadClients()) != 0 {
		t.Fatalf("exit %d, download clients should be gone\n%s", r.Code, r.Out)
	}
}

func TestSonarrIsRestartedOnceWhenFormsLoginNeedsIt(t *testing.T) {
	e := newEnv(t, arr.Sonarr())
	e.Sonarr.RequireRestart = true

	r := e.Run("install", "sonarr", "--yes", "--json")

	if r.Code != 0 || r.StepEvent("sonarr", "auth") != "step.ok" {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	restarts := 0
	for _, call := range e.Deps.Runner.(*systemtest.Runner).Calls() {
		if strings.HasSuffix(call, "restart sonarr") {
			restarts++
		}
	}
	if restarts != 1 {
		t.Fatalf("restarts = %d, want exactly one", restarts)
	}
}

func TestProwlarrNeedsNoMediaFolders(t *testing.T) {
	if arr.Prowlarr().Info().UsesMedia {
		t.Fatal("Prowlarr mounts no media or downloads folder")
	}
}

func TestAPIKeysNeverAppearInEvents(t *testing.T) {
	e := arrtest.New(t, catalog.Default())

	r := e.Run("install", "media", "--yes", "--json", "--verbose")

	for _, key := range []string{e.Sonarr.Key, e.Radarr.Key, e.Prowlarr.Key} {
		if strings.Contains(r.Out, key) {
			t.Fatalf("API key %q leaked into events", key)
		}
	}
	if _, pass := adminLogin(t, e); strings.Contains(r.Out, pass) {
		t.Fatal("Admin password leaked into events")
	}
}
