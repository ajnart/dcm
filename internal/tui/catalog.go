package tui

import (
	"slices"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/service"
)

type catalogItem struct {
	key, name, desc string
	installed       bool
	recipe          bool
}

func (m Model) installedIDs() []string {
	var ids []string
	for _, a := range m.status.Apps {
		ids = append(ids, a.ID)
	}
	return ids
}

// catalogItems lists Recipes then Apps, filtered by the catalog filter.
func (m Model) catalogItems() []catalogItem {
	cat := m.backend.Catalog()
	installed := m.installedIDs()
	var items []catalogItem
	for _, r := range cat.Recipes() {
		items = append(items, catalogItem{key: "recipe:" + r.ID, name: "📦 " + r.Name, desc: r.Description + " (" + strings.Join(r.Apps, ", ") + ")", recipe: true})
	}
	apps := cat.Apps()
	slices.SortFunc(apps, func(a, b app.App) int {
		return strings.Compare(strings.ToLower(a.Info().Name), strings.ToLower(b.Info().Name))
	})
	for _, a := range apps {
		info := a.Info()
		items = append(items, catalogItem{key: "app:" + info.ID, name: info.Name, desc: info.Description, installed: slices.Contains(installed, info.ID)})
	}
	query := strings.ToLower(strings.TrimSpace(m.catalogFilter.Value()))
	if query == "" {
		return items
	}
	var filtered []catalogItem
	for _, it := range items {
		if strings.Contains(strings.ToLower(it.key+" "+it.name+" "+it.desc), query) {
			filtered = append(filtered, it)
		}
	}
	return filtered
}

func (m Model) handleCatalogKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	k := m.keys
	if m.catalogPlan != nil {
		switch msg.String() {
		case "enter", "y":
			p := m.catalogPlan
			return m.installPlan(p)
		case "esc", "n":
			m.catalogPlan = nil
		}
		return m, nil
	}
	if m.catalogFiltered {
		switch msg.String() {
		case "enter", "esc":
			m.catalogFiltered = false
			m.catalogFilter.Blur()
			if msg.String() == "esc" {
				m.catalogFilter.Reset()
			}
			return m, nil
		}
		var cmd tea.Cmd
		m.catalogFilter, cmd = m.catalogFilter.Update(msg)
		m.catalogCursor = 0
		return m, cmd
	}
	items := m.catalogItems()
	switch {
	case key.Matches(msg, k.Up):
		m.catalogCursor = max(m.catalogCursor-1, 0)
	case key.Matches(msg, k.Down):
		m.catalogCursor = min(m.catalogCursor+1, max(len(items)-1, 0))
	case key.Matches(msg, k.Filter):
		m.catalogFiltered = true
		return m, m.catalogFilter.Focus()
	case key.Matches(msg, k.Clear):
		m.catalogFilter.Reset()
	case msg.String() == "space" || msg.String() == "x":
		if m.catalogCursor < len(items) && !items[m.catalogCursor].installed {
			it := items[m.catalogCursor]
			m.catalogPicked[it.key] = !m.catalogPicked[it.key]
		}
	case msg.String() == "enter":
		return m.planCatalog()
	}
	return m, nil
}

func (m Model) planCatalog() (tea.Model, tea.Cmd) {
	cat := m.backend.Catalog()
	var picked []string
	for keyName, on := range m.catalogPicked {
		if on {
			picked = append(picked, keyName)
		}
	}
	slices.Sort(picked)
	installed := m.installedIDs()
	var apps []app.App
	for _, a := range expand(cat, picked) {
		if !slices.Contains(installed, a.Info().ID) {
			apps = append(apps, a)
		}
	}
	if len(apps) == 0 {
		m.setFlash("pick Apps with space first (installed Apps are skipped)", levelWarn)
		return m, nil
	}
	opts := service.InstallOptions{}
	for _, a := range apps {
		opts.Targets = append(opts.Targets, a.Info().ID)
		for _, in := range a.Inputs() {
			if in.Required && in.Default == "" {
				m.setFlash(a.Info().ID+" needs "+in.Key+": self-host install "+a.Info().ID+" --set "+a.Info().ID+"."+in.Key+"=…", levelWarn)
				return m, nil
			}
		}
	}
	settings := map[string]string{}
	for k, v := range m.status.Settings {
		settings[k] = v
	}
	m.catalogPlan = &plan{apps: apps, opts: opts, links: linksBetween(cat, apps, installed), settings: settings}
	return m, nil
}

func (m Model) renderCatalogScreen() string {
	t := m.theme
	if m.catalogPlan != nil {
		return m.renderPlan(m.catalogPlan, "install · esc back")
	}
	lines := []string{"", "  " + t.heading().Render("Catalog") + t.dim().Render("  space picks · / filters · enter reviews"), ""}
	if m.catalogFiltered || m.catalogFilter.Value() != "" {
		lines = append(lines, "  "+m.catalogFilter.View(), "")
	}
	width := max(m.width-4, 20)
	for i, it := range m.catalogItems() {
		mark := "[ ]"
		switch {
		case it.installed:
			mark = t.fg(t.ok).Render(" ✓ ")
		case m.catalogPicked[it.key]:
			mark = t.fg(t.accent).Render("[x]")
		}
		desc := it.desc
		if it.installed {
			desc += " · installed"
		}
		line := mark + " " + pad(it.name, 22) + " " + t.dim().Render(desc)
		if i == m.catalogCursor {
			line = lipgloss.NewStyle().Background(t.selected).Bold(true).Render(pad(stripANSI(line), width))
		}
		lines = append(lines, "  "+line)
	}
	return strings.Join(lines, "\n")
}
