package service

import (
	"context"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/systemtest"
)

type describedApp struct {
	testApp
	name, description string
}

func (a *describedApp) Info() app.Info {
	info := a.testApp.Info()
	info.Name, info.Description = a.name, a.description
	return info
}

func recipeHarness(t *testing.T, recipes []catalog.Recipe, apps ...app.App) *harness {
	t.Helper()
	deps := systemtest.NewDeps(t)
	rec := &recorder{}
	svc := New(deps, events.New(rec), catalog.New(apps, recipes))
	return &harness{t: t, deps: deps, runner: deps.Runner.(*systemtest.Runner), svc: svc, rec: rec}
}

func appStatus(t *testing.T, h *harness, id string) AppStatus {
	t.Helper()
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range status.Apps {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("no App %q in status %+v", id, status.Apps)
	return AppStatus{}
}

func TestStatusRecordsTheRecipeAnAppWasInstalledThrough(t *testing.T) {
	done := map[string]bool{}
	h := recipeHarness(t,
		[]catalog.Recipe{{ID: "movies", Name: "Watch movies", Apps: []string{"one", "two"}}},
		&testApp{id: "one", done: done}, &testApp{id: "two", done: done}, &testApp{id: "three", done: done})
	if err := h.install("movies", "three"); err != nil {
		t.Fatal(err)
	}
	if got := appStatus(t, h, "one").Recipe; got != "movies" {
		t.Fatalf("recipe of one = %q, want movies", got)
	}
	if got := appStatus(t, h, "three").Recipe; got != "" {
		t.Fatalf("recipe of three = %q, want none", got)
	}
}

func TestStatusRecordsTheFirstRecipeWhenSeveralShareAnApp(t *testing.T) {
	done := map[string]bool{}
	h := recipeHarness(t,
		[]catalog.Recipe{
			{ID: "movies", Name: "Watch movies", Apps: []string{"one"}},
			{ID: "music", Name: "Listen to music", Apps: []string{"one", "two"}},
		},
		&testApp{id: "one", done: done}, &testApp{id: "two", done: done})
	if err := h.install("music", "movies"); err != nil {
		t.Fatal(err)
	}
	if got := appStatus(t, h, "one").Recipe; got != "music" {
		t.Fatalf("recipe of one = %q, want music", got)
	}
}

func TestStatusKeepsTheRecipeWhenAnAppIsInstalledAgainDirectly(t *testing.T) {
	done := map[string]bool{}
	h := recipeHarness(t,
		[]catalog.Recipe{{ID: "movies", Name: "Watch movies", Apps: []string{"one"}}},
		&testApp{id: "one", done: done})
	for _, target := range []string{"movies", "one"} {
		if err := h.install(target); err != nil {
			t.Fatal(err)
		}
	}
	if got := appStatus(t, h, "one").Recipe; got != "movies" {
		t.Fatalf("recipe of one = %q, want movies", got)
	}
}

func TestStatusDescribesAppsAndLocatesTheHomeFolderAndDashboard(t *testing.T) {
	done := map[string]bool{}
	h := recipeHarness(t, nil,
		&describedApp{testApp: testApp{id: "jellyfin", done: done}, name: "Jellyfin", description: "Streams your movies, shows and music to every screen"},
		&describedApp{testApp: testApp{id: "homarr", done: done}, name: "Homarr", description: "Dashboard for your Apps"})
	if err := h.install("jellyfin", "homarr"); err != nil {
		t.Fatal(err)
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	jellyfin := appStatus(t, h, "jellyfin")
	if jellyfin.Description != "Streams your movies, shows and music to every screen" {
		t.Fatalf("description = %q", jellyfin.Description)
	}
	if jellyfin.URL != "http://192.168.1.20:9000" || len(jellyfin.Addresses) != 1 || jellyfin.Addresses[0] != "http://192.168.1.20:9000" {
		t.Fatalf("url %q addresses %q, want http://192.168.1.20:9000 only", jellyfin.URL, jellyfin.Addresses)
	}
	if status.Home != h.root() {
		t.Fatalf("home = %q, want %q", status.Home, h.root())
	}
	if status.Dashboard != "http://192.168.1.20:9001" {
		t.Fatalf("dashboard = %q, want http://192.168.1.20:9001", status.Dashboard)
	}
}

func TestStatusHasNoDashboardWithoutHomarr(t *testing.T) {
	h := recipeHarness(t, nil, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Dashboard != "" {
		t.Fatalf("dashboard = %q, want none", status.Dashboard)
	}
}
