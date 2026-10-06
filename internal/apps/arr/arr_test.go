package arr_test

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
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
