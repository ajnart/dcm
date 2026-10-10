// Package catalog is the registry of Apps and Recipes compiled into the binary.
package catalog

import (
	"sort"

	"github.com/ajnart/self-host/internal/app"
)

type Recipe struct {
	ID          string
	Name        string
	Description string
	Apps        []string
}

type Catalog struct {
	apps    map[string]app.App
	order   []string
	recipes []Recipe
}

func New(apps []app.App, recipes []Recipe) *Catalog {
	c := &Catalog{apps: map[string]app.App{}, recipes: recipes}
	for _, a := range apps {
		id := a.Info().ID
		c.apps[id] = a
		c.order = append(c.order, id)
	}
	sort.Strings(c.order)
	return c
}

func (c *Catalog) App(id string) (app.App, bool) {
	a, found := c.apps[id]
	return a, found
}

func (c *Catalog) Apps() []app.App {
	apps := make([]app.App, len(c.order))
	for i, id := range c.order {
		apps[i] = c.apps[id]
	}
	return apps
}

func (c *Catalog) Recipes() []Recipe {
	var recipes []Recipe
	for _, r := range c.recipes {
		if r.ID != "homarr-control-plane" {
			recipes = append(recipes, r)
		}
	}
	return recipes
}

func (c *Catalog) Recipe(id string) (Recipe, bool) {
	for _, r := range c.recipes {
		if r.ID == id {
			return r, true
		}
	}
	return Recipe{}, false
}

// Expand resolves a name a person typed. A Recipe wins over an App of the same
// name and answers its own ID with the IDs of its Apps; an App answers an empty
// recipe ID with its own ID. found is false for any other name.
func (c *Catalog) Expand(name string) (recipe string, appIDs []string, found bool) {
	if r, ok := c.Recipe(name); ok {
		return r.ID, r.Apps, true
	}
	if _, ok := c.App(name); ok {
		return "", []string{name}, true
	}
	return "", nil, false
}
