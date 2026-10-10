package service

import (
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestAnArgumentThatIsAnAppAndARecipeMeansTheRecipeEverywhere(t *testing.T) {
	apps := []app.App{
		&testApp{id: "media", done: map[string]bool{}},
		&testApp{id: "jellyfin", done: map[string]bool{}},
		&testApp{id: "ntfy", done: map[string]bool{}},
	}
	recipes := []catalog.Recipe{{ID: "media", Apps: []string{"jellyfin", "ntfy"}}}
	svc := New(systemtest.NewDeps(t), events.New(&recorder{}), catalog.New(apps, recipes))

	resolved, err := svc.Resolve([]string{"media"})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, a := range resolved {
		ids = append(ids, a.Info().ID)
	}
	if want := []string{"jellyfin", "ntfy"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("Resolve = %v, want %v", ids, want)
	}
	if got, want := svc.recipeOf([]string{"media"}), map[string]string{"jellyfin": "media", "ntfy": "media"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("recipeOf = %v, want %v", got, want)
	}
}
