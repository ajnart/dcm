package tui

import (
	"slices"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
)

// whatList is the What step's list of Recipes and Apps. Picking a Recipe
// picks its Apps, so the picks live in the answers, not here.
type whatList struct {
	cursor, offset int
	search         textinput.Model
	filtering      bool
	err            string
}

func (m Model) newWhatList() *whatList {
	l := &whatList{search: textinput.New()}
	l.search.Prompt = "/ "
	l.search.Placeholder = "filter by name or description"
	l.search.SetWidth(max(m.formWidth()-6, 10))
	for i, it := range m.whatRows(l) {
		if m.whatMark(it) != pickNone {
			l.cursor = i
			break
		}
	}
	return l
}

// whatItems lists the Recipes first, then the Apps by name.
func whatItems(cat *catalog.Catalog, recipe string) []installItem {
	var items []installItem
	for _, r := range cat.Recipes() {
		items = append(items, installItem{key: "recipe:" + r.ID, id: r.ID, name: recipe + " " + r.Name + " (Recipe)", desc: r.Description})
	}
	apps := cat.Apps()
	slices.SortFunc(apps, func(a, b app.App) int {
		return strings.Compare(strings.ToLower(a.Info().Name), strings.ToLower(b.Info().Name))
	})
	for _, a := range apps {
		info := a.Info()
		items = append(items, installItem{key: "app:" + info.ID, id: info.ID, name: info.Name, desc: info.Description, category: info.Category})
	}
	return items
}

func (m Model) whatRows(l *whatList) []installItem {
	return filterItems(whatItems(m.backend.Catalog(), m.glyphs.Recipe()), l.search.Value())
}

// whatMark is how much of the row is picked: an App is all or none, a
// Recipe as many of its Apps as are picked.
func (m Model) whatMark(it installItem) pickMark {
	p := m.onboarding.answers.picks
	if strings.HasPrefix(it.key, "recipe:") {
		r, _ := m.backend.Catalog().Recipe(it.id)
		return p.recipeMark(r, nil)
	}
	if p[it.id] {
		return pickAll
	}
	return pickNone
}

// whatKey handles a key on the What list; filtering keeps letters for the
// filter and leaves the arrows and enter to the list.
func (m Model) whatKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	o := m.onboarding
	l := o.list
	rows := m.whatRows(l)
	switch msg.String() {
	case "ctrl+c":
		return m.backToWelcome()
	case "up":
		l.cursor = max(l.cursor-1, 0)
	case "down":
		l.cursor = min(l.cursor+1, max(len(rows)-1, 0))
	case "pgup":
		l.cursor = max(l.cursor-5, 0)
	case "pgdown":
		l.cursor = min(l.cursor+5, max(len(rows)-1, 0))
	case "enter":
		if l.filtering {
			l.filtering = false
			l.search.Blur()
			return m, nil
		}
		return m.whatNext()
	case "esc":
		switch {
		case l.filtering || l.search.Value() != "":
			l.filtering, l.cursor = false, 0
			l.search.Reset()
			l.search.Blur()
		default:
			return m.openStep(stepWelcome)
		}
	default:
		switch {
		case l.filtering:
			l.search, _ = l.search.Update(msg)
			l.cursor = 0
		case msg.String() == "/":
			l.filtering = true
			l.search.Focus()
		case msg.String() == "k":
			l.cursor = max(l.cursor-1, 0)
		case msg.String() == "j":
			l.cursor = min(l.cursor+1, max(len(rows)-1, 0))
		case (msg.String() == "x" || msg.String() == "space") && l.cursor < len(rows):
			o.answers.picks.toggle(m.backend.Catalog(), rows[l.cursor].key, nil)
			l.err = ""
		}
	}
	return m, nil
}

// whatNext leaves the list for the picked Apps' own inputs, if any ask for
// some, or for Where.
func (m Model) whatNext() (tea.Model, tea.Cmd) {
	o := m.onboarding
	apps := o.answers.picks.apps(m.backend.Catalog())
	if len(apps) == 0 {
		o.list.err = "pick at least one Recipe or App"
		return m, nil
	}
	if !slices.ContainsFunc(apps, func(a app.App) bool { return len(a.Inputs()) > 0 }) {
		return m.openStep(stepWhere)
	}
	o.list, o.form = nil, m.buildForm(stepWhat)
	return m, o.form.Init()
}

// whatListHeight is what the list has left above the hovered description.
func (m Model) whatListHeight() int {
	return max(m.formHeight(stepWhat)-whatDetailLines-1, 4)
}

// renderWhatList draws the list: a title, the rows the height allows around
// the cursor, and a line of keys, or of what is wrong.
func (m Model) renderWhatList() []string {
	t := m.theme
	l := m.onboarding.list
	width := max(m.width-4, 20)
	rows := m.whatRows(l)
	head := t.heading().Render("Apps and Recipes")
	if l.filtering || l.search.Value() != "" {
		head = l.search.View()
	}
	avail := max(m.whatListHeight()-2, 1)
	l.cursor = max(min(l.cursor, len(rows)-1), 0)
	if l.cursor < l.offset {
		l.offset = l.cursor
	}
	if l.cursor >= l.offset+avail {
		l.offset = l.cursor - avail + 1
	}
	l.offset = max(min(l.offset, max(len(rows)-avail, 0)), 0)

	lines := []string{"  " + truncate(head, width)}
	for i := l.offset; i < len(rows) && i-l.offset < avail; i++ {
		it := rows[i]
		cursor, style := "  ", t.body()
		if i == l.cursor {
			cursor, style = t.cursor(), t.active()
		}
		mark := m.whatMark(it)
		markStyle := t.dim()
		if mark != pickNone {
			markStyle = t.title()
		}
		lines = append(lines, "  "+truncate(cursor+markStyle.Render(mark.glyph())+" "+style.Render(it.name), width))
	}
	if len(rows) == 0 {
		lines = append(lines, "  "+t.dim().Render("Nothing matches."))
	}
	footer := t.dim().Render("x toggle · / filter · ↑/↓ move")
	switch {
	case l.err != "":
		footer = t.fg(t.fail).Render("✗ " + l.err)
	case len(rows) > avail:
		footer = t.dim().Render("x toggle · / filter · ↑/↓ move · " + strconv.Itoa(len(rows)-avail) + " more")
	}
	return append(lines, "  "+truncate(footer, width))
}
