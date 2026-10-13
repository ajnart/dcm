package seerr_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/arr"
	"github.com/ajnart/self-host/internal/apps/arrtest"
	"github.com/ajnart/self-host/internal/apps/jellyfin"
	"github.com/ajnart/self-host/internal/apps/seerr"
	"github.com/ajnart/self-host/internal/catalog"
)

func newEnv(t *testing.T, apps ...app.App) *arrtest.Env {
	return arrtest.New(t, catalog.New(apps, nil))
}

func requestApps() []app.App {
	return []app.App{arr.Sonarr(), arr.Radarr(), jellyfin.App{}, seerr.App{}}
}

func TestSeerrSignsInToJellyfinAndSendsRequestsToSonarrAndRadarr(t *testing.T) {
	e := newEnv(t, requestApps()...)

	r := e.Run("install", "sonarr", "radarr", "jellyfin", "seerr", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if !e.Seerr.Initialized() {
		t.Error("Seerr setup not finished (settings/initialize)")
	}
	if got := e.Seerr.EnabledLibraries(); !slices.Equal(got, []string{"Movies", "Shows"}) {
		t.Errorf("enabled libraries %v, want Movies and Shows", got)
	}
	for kind, folder := range map[string]string{"sonarr": "/media/tv", "radarr": "/media/movies"} {
		servers := e.Seerr.Servers(kind)
		if len(servers) != 1 {
			t.Fatalf("%s servers %v", kind, servers)
		}
		s := servers[0]
		if s["hostname"] != kind || s["activeDirectory"] != folder || s["isDefault"] != true || s["activeProfileId"] != float64(1) {
			t.Errorf("%s server %v", kind, s)
		}
	}
	if e.Seerr.Servers("radarr")[0]["minimumAvailability"] != "released" {
		t.Errorf("radarr server lacks minimumAvailability: %v", e.Seerr.Servers("radarr")[0])
	}
	for _, step := range []string{"link-jellyfin", "link-sonarr", "link-radarr"} {
		if r.StepEvent("seerr", step) != "step.ok" {
			t.Errorf("seerr %s not ok:\n%s", step, r.Out)
		}
	}
}

func TestRerunAddsNoSecondServer(t *testing.T) {
	e := newEnv(t, requestApps()...)
	e.Run("install", "sonarr", "radarr", "jellyfin", "seerr", "--yes")

	r := e.Run("setup", "seerr", "--json")

	if r.Code != 0 || len(e.Seerr.Servers("sonarr")) != 1 || len(e.Seerr.Servers("radarr")) != 1 {
		t.Fatalf("exit %d, sonarr %v, radarr %v\n%s", r.Code, e.Seerr.Servers("sonarr"), e.Seerr.Servers("radarr"), r.Out)
	}
	for _, step := range []string{"link-jellyfin", "link-sonarr", "link-radarr"} {
		if r.StepEvent("seerr", step) != "step.skip" {
			t.Errorf("seerr %s should be skipped:\n%s", step, r.Out)
		}
	}
}

func TestWithoutJellyfinSeerrDoesNotScheduleItsJellyfinLink(t *testing.T) {
	e := newEnv(t, requestApps()...)

	r := e.Run("install", "sonarr", "seerr", "--yes", "--json")

	if r.StepEvent("seerr", "link-jellyfin") != "" {
		t.Errorf("an absent Jellyfin must not schedule its Link:\n%s", r.Out)
	}
	step := r.Step("seerr", "link-sonarr")
	if r.Code != 2 || step == nil || step["event"] != "step.fail" || !strings.Contains(step["error"].(string), "link-jellyfin") {
		t.Fatalf("link-sonarr should fail until Jellyfin is linked, exit %d\n%s", r.Code, r.Out)
	}
	if !strings.Contains(step["hint"].(string), "/settings/services") {
		t.Errorf("hint should name the Seerr page: %v", step["hint"])
	}

	// Installing Jellyfin retries the failed Sonarr Link after the Jellyfin one.
	if r := e.Run("install", "jellyfin", "--yes"); r.Code != 0 || len(e.Seerr.Servers("sonarr")) != 1 {
		t.Fatalf("Seerr should finish once Jellyfin is ready, exit %d\n%s", r.Code, r.Out)
	}
}

func TestRemovingSonarrRemovesItFromSeerr(t *testing.T) {
	e := newEnv(t, requestApps()...)
	e.Run("install", "sonarr", "radarr", "jellyfin", "seerr", "--yes")

	if r := e.Run("remove", "sonarr", "--yes"); r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}

	if len(e.Seerr.Servers("sonarr")) != 0 || len(e.Seerr.Servers("radarr")) != 1 {
		t.Fatalf("sonarr %v radarr %v", e.Seerr.Servers("sonarr"), e.Seerr.Servers("radarr"))
	}
}

func TestMediaRecipeInstallsAndWiresEverything(t *testing.T) {
	e := arrtest.New(t, catalog.Default())

	r := e.Run("install", "media", "--yes", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	for _, link := range [][2]string{
		{"sonarr", "link-qbittorrent"}, {"radarr", "link-qbittorrent"}, {"prowlarr", "link-sonarr"}, {"prowlarr", "link-radarr"},
		{"seerr", "link-jellyfin"}, {"seerr", "link-sonarr"}, {"seerr", "link-radarr"},
	} {
		if r.StepEvent(link[0], link[1]) != "step.ok" {
			t.Errorf("%s %s not ok:\n%s", link[0], link[1], r.Out)
		}
	}
}
