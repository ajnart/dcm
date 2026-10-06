package qbittorrent_test

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/apps/qbittorrent"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
)

func newEnv(t *testing.T) *arrtest.Env {
	return arrtest.New(t, catalog.New([]app.App{qbittorrent.App{}}, nil))
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

func TestInstallReplacesTheTemporaryPasswordWithTheAdminLogin(t *testing.T) {
	e := newEnv(t)

	r := e.Run("install", "qbittorrent", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	user, pass := adminLogin(t, e)
	gotUser, gotPass := e.QBittorrent.Credentials()
	if gotUser != user || gotPass != pass || pass == e.QBittorrent.TempPassword {
		t.Fatalf("qBittorrent login is %s/%s, want the Admin login %s/%s", gotUser, gotPass, user, pass)
	}
	if e.QBittorrent.SavePath() != "/downloads" {
		t.Errorf("save path %q, want /downloads", e.QBittorrent.SavePath())
	}
	for _, step := range []string{"admin-login", "save-path", "check"} {
		if r.StepEvent("qbittorrent", step) != "step.ok" {
			t.Errorf("step %s not ok:\n%s", step, r.Out)
		}
	}
}

func TestFragmentUsesLinuxserverImageAndHostSettings(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "qbittorrent", "--yes")

	fragment := clitest.Read(t, filepath.Join(e.AppDir("qbittorrent"), "compose.yml"))

	port := e.Port("qbittorrent")
	for _, want := range []string{
		"image: lscr.io/linuxserver/qbittorrent:latest",
		"PUID: ${PUID}", "PGID: ${PGID}", "TZ: ${TZ}", "UMASK: ${UMASK}",
		`WEBUI_PORT: "` + port + `"`,
		"${BIND_IP}:" + port + ":" + port,
		"6881:6881/udp",
		"./config:/config",
		"${DOWNLOADS_ROOT}:/downloads",
	} {
		if !strings.Contains(fragment, want) {
			t.Errorf("fragment lacks %q:\n%s", want, fragment)
		}
	}
}

func TestSetupRerunSkipsEveryStep(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "qbittorrent", "--yes")
	failures := e.QBittorrent.FailedLogins()

	r := e.Run("setup", "qbittorrent", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	for _, step := range []string{"admin-login", "save-path"} {
		if r.StepEvent("qbittorrent", step) != "step.skip" {
			t.Errorf("step %s should skip:\n%s", step, r.Out)
		}
	}
	if e.QBittorrent.FailedLogins() != failures {
		t.Error("a rerun must not trigger failed logins; qBittorrent bans repeat offenders")
	}
}
