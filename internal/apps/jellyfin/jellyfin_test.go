package jellyfin_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/apps/jellyfin"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
)

func newEnv(t *testing.T) *arrtest.Env {
	return arrtest.New(t, catalog.New([]app.App{jellyfin.App{}}, nil))
}

func adminLogin(t *testing.T, e *arrtest.Env) (string, string) {
	t.Helper()
	var parsed struct {
		Admin struct{ Username, Password string }
	}
	if err := json.Unmarshal([]byte(e.Run("credentials", "--json").Out), &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed.Admin.Username, parsed.Admin.Password
}

func libraries(e *arrtest.Env) []string {
	var out []string
	for _, l := range e.Jellyfin.Libraries() {
		out = append(out, l.Name+" "+l.CollectionType+" "+strings.Join(l.Locations, ","))
	}
	return out
}

func TestInstallFinishesTheWizardCreatesAKeyAndLibraries(t *testing.T) {
	e := newEnv(t)

	r := e.Run("install", "jellyfin", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	user, pass := adminLogin(t, e)
	if gotUser, gotPass := e.Jellyfin.Admin(); gotUser != user || gotPass != pass {
		t.Errorf("Jellyfin admin is %q, want the Admin login %q", gotUser, user)
	}
	if !slices.Equal(e.Jellyfin.Keys(), []string{"selfhost"}) {
		t.Errorf("API keys %v, want one named selfhost", e.Jellyfin.Keys())
	}
	if !strings.Contains(clitest.Read(t, filepath.Join(clitest.Root(t, e.Deps), "secrets.env")), "JELLYFIN_API_KEY=selfhost-key-1") {
		t.Error("secrets.env lacks the Jellyfin API key")
	}
	want := []string{"Movies movies /media/movies", "Shows tvshows /media/tv"}
	if got := libraries(e); !slices.Equal(got, want) {
		t.Errorf("libraries %v, want %v", got, want)
	}
	for _, step := range []string{"wizard", "api-key", "library-movies", "library-tv", "check"} {
		if r.StepEvent("jellyfin", step) != "step.ok" {
			t.Errorf("step %s not ok:\n%s", step, r.Out)
		}
	}
}

func TestLibrariesFollowExtraMediaFolders(t *testing.T) {
	e := newEnv(t)
	user, _ := e.Deps.CurrentUser()
	if err := os.MkdirAll(filepath.Join(user.Home, "media", "music"), 0o755); err != nil {
		t.Fatal(err)
	}

	if r := e.Run("install", "jellyfin", "--yes"); r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}

	want := []string{"Movies movies /media/movies", "Shows tvshows /media/tv", "Music music /media/music"}
	if got := libraries(e); !slices.Equal(got, want) {
		t.Errorf("libraries %v, want %v (no Books folder, so no Books library)", got, want)
	}
}

func TestRerunChangesNothing(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "jellyfin", "--yes")

	r := e.Run("setup", "jellyfin", "--json")

	if r.Code != 0 || e.Jellyfin.WizardRuns() != 1 || len(e.Jellyfin.Keys()) != 1 || len(e.Jellyfin.Libraries()) != 2 {
		t.Fatalf("rerun changed Jellyfin: exit %d, wizard %d, keys %v, libraries %v\n%s",
			r.Code, e.Jellyfin.WizardRuns(), e.Jellyfin.Keys(), libraries(e), r.Out)
	}
	for _, step := range []string{"wizard", "api-key", "library-movies", "library-tv"} {
		if r.StepEvent("jellyfin", step) != "step.skip" {
			t.Errorf("step %s should be skipped on rerun:\n%s", step, r.Out)
		}
	}
}

func TestSetupWaitsForTheBootPlaceholder(t *testing.T) {
	e := newEnv(t)
	e.Jellyfin.Booting = 3

	if r := e.Run("install", "jellyfin", "--yes"); r.Code != 0 || e.Jellyfin.WizardRuns() != 1 {
		t.Fatalf("exit %d, wizard runs %d\n%s", r.Code, e.Jellyfin.WizardRuns(), r.Out)
	}
}

func TestAnInterruptedWizardResumes(t *testing.T) {
	e := newEnv(t)
	e.Jellyfin.FailComplete = 1

	first := e.Run("install", "jellyfin", "--yes", "--json")
	if first.Code != 2 || first.StepEvent("jellyfin", "wizard") != "step.fail" {
		t.Fatalf("first run should leave Setup incomplete, exit %d\n%s", first.Code, first.Out)
	}
	if hint := first.Step("jellyfin", "wizard")["hint"].(string); !strings.Contains(hint, "self-host credentials") {
		t.Errorf("hint should point at the credentials: %q", hint)
	}

	// The admin password is already set: POST /Startup/User now answers 403.
	r := e.Run("setup", "jellyfin", "--json")

	if r.Code != 0 || r.StepEvent("jellyfin", "wizard") != "step.ok" {
		t.Fatalf("rerun should finish the wizard, exit %d\n%s", r.Code, r.Out)
	}
}

func TestFragmentMountsMediaAndPublishesTheLANURL(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "jellyfin", "--yes")

	fragment := clitest.Read(t, filepath.Join(e.AppDir("jellyfin"), "compose.yml"))

	for _, want := range []string{"image: lscr.io/linuxserver/jellyfin:latest", "${MEDIA_ROOT}:/media", "./config:/config",
		"JELLYFIN_PublishedServerUrl: http://${LAN_IP}:" + e.Port("jellyfin"), "${BIND_IP}:" + e.Port("jellyfin") + ":8096"} {
		if !strings.Contains(fragment, want) {
			t.Errorf("fragment lacks %q:\n%s", want, fragment)
		}
	}
}

// After a restart (or a restore) the boot placeholder claims the wizard is
// unfinished; Setup must wait for the real server instead of rerunning it.
func TestSetupAfterARestartDoesNotRerunTheWizard(t *testing.T) {
	e := newEnv(t)
	e.Run("install", "jellyfin", "--yes")
	e.Jellyfin.Booting = 3

	r := e.Run("setup", "jellyfin", "--json")

	if r.Code != 0 || r.StepEvent("jellyfin", "wizard") != "step.skip" || e.Jellyfin.WizardRuns() != 1 {
		t.Fatalf("exit %d, wizard runs %d\n%s", r.Code, e.Jellyfin.WizardRuns(), r.Out)
	}
}
