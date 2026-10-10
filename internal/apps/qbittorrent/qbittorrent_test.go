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
	"github.com/ajnart/self-host/internal/systemtest"
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

func TestLegacyLoginShapeStillWorks(t *testing.T) {
	e := newEnv(t)
	e.QBittorrent.Legacy = true

	r := e.Run("install", "qbittorrent", "--yes", "--json")

	if r.Code != 0 || r.StepEvent("qbittorrent", "admin-login") != "step.ok" {
		t.Fatalf("≤5.1 login shape (200 Ok. + SID) should still work, exit %d\n%s", r.Code, r.Out)
	}
}

func TestCredentialsAreSetInOneValidatedChange(t *testing.T) {
	e := newEnv(t)

	e.Run("install", "qbittorrent", "--yes")

	if got := e.QBittorrent.CredentialUpdates(); got != 1 {
		t.Fatalf("credential updates = %d, want exactly one combined change", got)
	}
	if e.QBittorrent.FailedLogins() >= 5 {
		t.Fatal("install must stay below qBittorrent's ban threshold")
	}
}

func TestTooShortAdminPasswordFailsBeforeTouchingQBittorrent(t *testing.T) {
	e := newEnv(t)
	systemtest.SetEnv(e.Deps, map[string]string{"SELF_HOST_ADMIN_PASSWORD": "abc12"})

	r := e.Run("install", "qbittorrent", "--yes", "--json")

	step := r.Step("qbittorrent", "admin-login")
	if r.Code != 2 || step == nil || step["event"] != "step.fail" || !strings.Contains(step["error"].(string), "6 characters") {
		t.Fatalf("short password should fail admin-login, exit %d\n%s", r.Code, r.Out)
	}
	if e.QBittorrent.CredentialUpdates() != 0 {
		t.Fatal("nothing may be changed when the Admin login is invalid for qBittorrent")
	}
}

func TestBannedIPIsReportedNotRetried(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "qbittorrent", "--yes")
	e.QBittorrent.Ban()

	r := e.Run("setup", "qbittorrent", "--json")

	step := r.Step("qbittorrent", "admin-login")
	if r.Code != 2 || step == nil || !strings.Contains(step["error"].(string), "banned") {
		t.Fatalf("a ban must surface as an error, exit %d\n%s", r.Code, r.Out)
	}
}

func TestSecretsNeverAppearInEvents(t *testing.T) {
	e := newEnv(t)

	r := e.Run("install", "qbittorrent", "--yes", "--json", "--verbose")

	_, pass := adminLogin(t, e)
	for _, secret := range []string{pass, e.QBittorrent.TempPassword} {
		if strings.Contains(r.Out, secret) {
			t.Fatalf("secret %q leaked into events", secret)
		}
	}
}

func TestPeerPortsFollowExposure(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "qbittorrent", "--yes")

	fragment := clitest.Read(t, filepath.Join(e.AppDir("qbittorrent"), "compose.yml"))

	for _, want := range []string{"${BIND_IP}:6881:6881\n", "${BIND_IP}:6881:6881/udp"} {
		if !strings.Contains(fragment, want) {
			t.Errorf("peer port not bound to ${BIND_IP}: want %q\n%s", want, fragment)
		}
	}
}

func TestInstallSelectsTorrentPortThroughCLI(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "qbittorrent", "--yes", "--set", "qbittorrent.torrent-port=24567")
	fragment := clitest.Read(t, filepath.Join(e.AppDir("qbittorrent"), "compose.yml"))
	for _, want := range []string{"TORRENTING_PORT: \"24567\"", "${BIND_IP}:24567:24567\n", "${BIND_IP}:24567:24567/udp"} {
		if !strings.Contains(fragment, want) {
			t.Errorf("selected peer port missing from installed fragment: %s", want)
		}
	}
	e.Run("check", "qbittorrent")
}
