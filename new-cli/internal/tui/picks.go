package tui

import (
	"slices"
	"strings"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
)

// picks are the Apps a person has picked, by ID. A Recipe is a shortcut for
// its Apps: picking it picks them, and its mark is derived from them. What
// and the Catalog share it, so the two lists behave alike.
type picks map[string]bool

// pickMark is how many of a Recipe's Apps are picked.
type pickMark int

const (
	pickNone pickMark = iota
	pickSome
	pickAll
)

func (k pickMark) glyph() string {
	switch k {
	case pickAll:
		return "✓"
	case pickSome:
		return "◐"
	}
	return "○"
}

// recipeMark counts an installed App as picked, so a Recipe whose Apps are
// already there reads as complete.
func (p picks) recipeMark(r catalog.Recipe, installed []string) pickMark {
	have := 0
	for _, id := range r.Apps {
		if p[id] || slices.Contains(installed, id) {
			have++
		}
	}
	switch {
	case have == 0:
		return pickNone
	case have == len(r.Apps):
		return pickAll
	}
	return pickSome
}

// toggle flips a "recipe:<id>" or "app:<id>" row. A Recipe that is not
// complete picks its remaining Apps; a complete one unpicks them all. An
// installed App is never picked.
func (p picks) toggle(cat *catalog.Catalog, key string, installed []string) {
	kind, id, _ := strings.Cut(key, ":")
	if kind != "recipe" {
		switch {
		case slices.Contains(installed, id):
		case p[id]:
			delete(p, id)
		default:
			p[id] = true
		}
		return
	}
	r, found := cat.Recipe(id)
	if !found {
		return
	}
	all := p.recipeMark(r, installed) == pickAll
	for _, appID := range r.Apps {
		switch {
		case slices.Contains(installed, appID):
		case all:
			delete(p, appID)
		default:
			p[appID] = true
		}
	}
}

// apps are the picked Apps that the Catalog has, in its order.
func (p picks) apps(cat *catalog.Catalog) []app.App {
	var picked []app.App
	for _, a := range cat.Apps() {
		if p[a.Info().ID] {
			picked = append(picked, a)
		}
	}
	return picked
}
