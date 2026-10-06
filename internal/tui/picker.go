package tui

import (
	"slices"
	"strings"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/service"
)

// picker is the install overlay: pick Recipes or Apps, review, install.
type picker struct {
	cursor int
	picked map[string]bool
	plan   *plan
}

type pickerItem struct {
	key, name, desc string
	installed       bool
}

func (m Model) openPicker() (tea.Model, tea.Cmd) {
	m.picker = &picker{picked: map[string]bool{}}
	return m, nil
}

func (m Model) installedIDs() []string {
	var ids []string
	for _, a := range m.status.Apps {
		ids = append(ids, a.ID)
	}
	return ids
}

// pickerItems lists Recipes, then Apps by name.
func (m Model) pickerItems() []pickerItem {
	cat := m.backend.Catalog()
	installed := m.installedIDs()
	var items []pickerItem
	for _, r := range cat.Recipes() {
		items = append(items, pickerItem{key: "recipe:" + r.ID, name: "📦 " + r.Name, desc: r.Description + " (" + strings.Join(r.Apps, ", ") + ")"})
	}
	apps := cat.Apps()
	slices.SortFunc(apps, func(a, b app.App) int {
		return strings.Compare(strings.ToLower(a.Info().Name), strings.ToLower(b.Info().Name))
	})
	for _, a := range apps {
		info := a.Info()
		items = append(items, pickerItem{key: "app:" + info.ID, name: info.Name, desc: info.Description, installed: slices.Contains(installed, info.ID)})
	}
	return items
}

func (m Model) handlePickerKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	p := m.picker
	if p.plan != nil {
		switch msg.String() {
		case "enter":
			plan := p.plan
			m.picker = nil
			return m.installPlan(plan)
		case "esc":
			p.plan = nil
		}
		return m, nil
	}
	items := m.pickerItems()
	switch {
	case msg.String() == "esc" || key.Matches(msg, m.keys.Quit):
		m.picker = nil
	case key.Matches(msg, m.keys.Up):
		p.cursor = max(p.cursor-1, 0)
	case key.Matches(msg, m.keys.Down):
		p.cursor = min(p.cursor+1, max(len(items)-1, 0))
	case msg.String() == "space":
		if p.cursor < len(items) && !items[p.cursor].installed {
			it := items[p.cursor]
			p.picked[it.key] = !p.picked[it.key]
		}
	case msg.String() == "enter":
		return m.planPicked()
	}
	return m, nil
}

func (m Model) planPicked() (tea.Model, tea.Cmd) {
	cat := m.backend.Catalog()
	var picked []string
	for k, on := range m.picker.picked {
		if on {
			picked = append(picked, k)
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
		m.setFlash("pick Apps with space first", levelWarn)
		return m, nil
	}
	opts := service.InstallOptions{}
	for _, a := range apps {
		info := a.Info()
		opts.Targets = append(opts.Targets, info.ID)
		for _, in := range a.Inputs() {
			if in.Required && in.Default == "" {
				m.setFlash(info.Name+" needs "+in.Key+": self-host install "+info.ID+" --set "+info.ID+"."+in.Key+"=…", levelWarn)
				return m, nil
			}
		}
	}
	settings := map[string]string{}
	for k, v := range m.status.Settings {
		settings[k] = v
	}
	m.picker.plan = &plan{apps: apps, opts: opts, links: linksBetween(cat, apps, installed), settings: settings}
	return m, nil
}

// renderPicker shows at most height items, scrolled to keep the cursor in view.
func (m Model) renderPicker(width, height int) string {
	t := m.theme
	p := m.picker
	if p.plan != nil {
		return m.renderPlan(p.plan, "install · esc back")
	}
	lines := []string{t.title().Render("Install") + t.dim().Render("  space picks · enter reviews · esc closes"), ""}
	items := m.pickerItems()
	offset := max(p.cursor-height+1, 0)
	for i := offset; i < len(items) && i-offset < height; i++ {
		it := items[i]
		mark := "[ ]"
		switch {
		case it.installed:
			mark = t.fg(t.ok).Render(" ✓ ")
		case p.picked[it.key]:
			mark = t.fg(t.accent).Render("[x]")
		}
		cursor := "  "
		if i == p.cursor {
			cursor = t.fg(t.accent).Render("> ")
		}
		desc := it.desc
		if it.installed {
			desc = "installed"
		}
		lines = append(lines, cursor+mark+" "+pad(it.name, 20)+" "+t.dim().Render(truncate(desc, max(width-30, 10))))
	}
	return strings.Join(lines, "\n")
}
