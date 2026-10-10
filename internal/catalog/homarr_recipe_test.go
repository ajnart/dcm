package catalog

import (
	"slices"
	"testing"
)

func TestHomarrRecipeIsOnlyACompatibilityAlias(t *testing.T) {
	c := Default()
	for _, r := range c.Recipes() {
		if r.ID == "homarr-control-plane" || slices.Equal(r.Apps, []string{"homarr"}) {
			t.Fatalf("Homarr must be offered as an App, not its own Recipe: %+v", r)
		}
	}
	recipe, apps, found := c.Expand("homarr-control-plane")
	if !found || recipe != "homarr-control-plane" || !slices.Equal(apps, []string{"homarr"}) {
		t.Fatalf("existing CLI Recipe identifier must still resolve: %q %v %v", recipe, apps, found)
	}
	recipe, apps, found = c.Expand("homarr")
	if !found || recipe != "" || !slices.Equal(apps, []string{"homarr"}) {
		t.Fatalf("deliberately choosing the Homarr App must still work: %q %v %v", recipe, apps, found)
	}
}
