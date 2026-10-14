package catalog

import (
	"slices"
	"testing"

	"github.com/ajnart/self-host/internal/app"
)

func TestHiddenAppsAreUnlistedButStillResolvable(t *testing.T) {
	c := New([]app.App{namedApp{id: "lldap"}, namedApp{id: "ntfy"}},
		[]Recipe{{ID: "mixed", Apps: []string{"lldap", "ntfy"}}, {ID: "only", Apps: []string{"lldap"}}})

	if got := c.Apps(); len(got) != 1 || got[0].Info().ID != "ntfy" {
		t.Fatalf("Apps listed a hidden App: %v", got)
	}
	if len(c.AllApps()) != 2 {
		t.Fatal("AllApps must keep the hidden App for existing installs")
	}
	if _, found := c.App("lldap"); !found {
		t.Fatal("an existing install must still resolve its App")
	}
	if Unavailable("lldap") == "" || Unavailable("ntfy") != "" {
		t.Fatal("unavailable reasons wrong")
	}
	recipes := c.Recipes()
	if len(recipes) != 1 || !slices.Equal(recipes[0].Apps, []string{"ntfy"}) {
		t.Fatalf("recipes: %v", recipes)
	}
}
