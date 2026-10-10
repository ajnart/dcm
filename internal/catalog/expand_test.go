package catalog

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/app"
)

type namedApp struct {
	app.App
	id string
}

func (a namedApp) Info() app.Info { return app.Info{ID: a.id} }

func TestExpandAnswersARecipeBeforeAnAppOfTheSameName(t *testing.T) {
	c := New([]app.App{namedApp{id: "media"}, namedApp{id: "jellyfin"}, namedApp{id: "ntfy"}},
		[]Recipe{{ID: "media", Apps: []string{"jellyfin", "ntfy"}}})

	for _, tc := range []struct {
		name   string
		recipe string
		apps   []string
		found  bool
	}{
		{"media", "media", []string{"jellyfin", "ntfy"}, true},
		{"jellyfin", "", []string{"jellyfin"}, true},
		{"ghost", "", nil, false},
	} {
		recipe, apps, found := c.Expand(tc.name)
		if recipe != tc.recipe || !reflect.DeepEqual(apps, tc.apps) || found != tc.found {
			t.Errorf("Expand(%q) = %q, %q, %v; want %q, %q, %v", tc.name, recipe, apps, found, tc.recipe, tc.apps, tc.found)
		}
	}
}
