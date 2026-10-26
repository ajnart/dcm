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

func newWhatList(ctx *viewContext) *whatList {
	l := &whatList{search: textinput.New()}
	l.search.Prompt = "/ "
	l.search.Placeholder = "filter by name or description"
	l.search.SetWidth(max(formWidth(ctx.width)-6, 10))
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

func whatRows(ctx *viewContext, l *whatList) []installItem {
	return filterItems(whatItems(ctx.backend.Catalog(), ctx.glyphs.Recipe()), l.search.Value())
}

// whatMark is how much of the row is picked: an App is all or none, a
// Recipe as many of its Apps as are picked.
func (o *onboarding) whatMark(ctx *viewContext, it installItem) pickMark {
	p := o.answers.picks
	if strings.HasPrefix(it.key, "recipe:") {
		r, _ := ctx.backend.Catalog().Recipe(it.id)
		return p.recipeMark(r, nil)
	}
	if p[it.id] {
		return pickAll
	}
	return pickNone
}

// whatKey handles a key on the What list; filtering keeps letters for the
// filter and leaves the arrows and enter to the list.
func (o *onboarding) whatKey(ctx *viewContext, msg tea.KeyPressMsg) (tea.Cmd, onboardingAsk) {
	l := o.list
	rows := whatRows(ctx, l)
	switch msg.String() {
	case "ctrl+c":
		return o.backToWelcome(ctx), onboardingAsk{}
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
			return nil, onboardingAsk{}
		}
		return o.whatNext(ctx), onboardingAsk{}
	case "esc":
		switch {
		case l.filtering || l.search.Value() != "":
			l.filtering, l.cursor = false, 0
			l.search.Reset()
			l.search.Blur()
		default:
			return o.openStep(ctx, stepWelcome), onboardingAsk{}
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
			o.answers.picks.toggle(ctx.backend.Catalog(), rows[l.cursor].key, nil)
			l.err = ""
		}
	}
	return nil, onboardingAsk{}
}

// whatNext leaves the list for the picked Apps' own inputs, if any ask for
// some, or for Where.
func (o *onboarding) whatNext(ctx *viewContext) tea.Cmd {
	apps := o.answers.picks.apps(ctx.backend.Catalog())
	if len(apps) == 0 {
		o.list.err = "pick at least one Recipe or App"
		return nil
	}
	if !slices.ContainsFunc(apps, func(a app.App) bool {
		return slices.ContainsFunc(a.Inputs(), func(in app.Input) bool { return !in.RecoveryOnly })
	}) {
		return o.openStep(ctx, stepWhere)
	}
	o.list, o.form = nil, o.buildForm(ctx, stepWhat)
	return o.form.Init()
}

// whatListHeight is what the list has left above the hovered description.
func (o *onboarding) whatListHeight(ctx *viewContext) int {
	return max(o.formHeight(ctx, stepWhat)-whatDetailRoom(ctx)-1, 4)
}

// renderWhatList draws the list: a title, the rows the height allows around
// the cursor, and a line of keys, or of what is wrong.
func (o *onboarding) renderWhatList(ctx *viewContext) []string {
	t := ctx.theme
	l := o.list
	width := max(ctx.width-4, 20)
	rows := whatRows(ctx, l)
	head := t.heading().Render("Apps and Recipes") + t.dim().Render(" · ✓ all · ◐ some · ○ none of a Recipe's Apps")
	if l.filtering || l.search.Value() != "" {
		head = l.search.View()
	}
	avail := max(o.whatListHeight(ctx)-2, 1)
	l.cursor = max(min(l.cursor, len(rows)-1), 0)
	l.offset = scrolled(l.cursor, l.offset, avail, len(rows))

	lines := []string{"  " + truncate(head, width)}
	for i := l.offset; i < len(rows) && i-l.offset < avail; i++ {
		it := rows[i]
		cursor, style := "  ", t.body()
		if i == l.cursor {
			cursor, style = t.cursor(), t.active()
		}
		mark := o.whatMark(ctx, it)
		markStyle := t.dim()
		if mark != pickNone {
			markStyle = t.title()
		}
		lines = append(lines, "  "+truncate(cursor+markStyle.Render(mark.glyph())+" "+style.Render(it.name), width))
	}
	if len(rows) == 0 {
		lines = append(lines, "  "+t.dim().Render("Nothing matches."))
	}
	footer := t.dim().Render("space toggle · / filter · ↑/↓ focus")
	switch {
	case l.filtering:
		footer = t.dim().Render("enter keep filter · esc clear")
	case l.err != "":
		footer = t.fg(t.fail).Render("✗ " + l.err)
	case len(rows) > avail:
		footer = t.dim().Render("space toggle · / filter · ↑/↓ focus · " + strconv.Itoa(len(rows)-avail) + " more")
	}
	return append(lines, "  "+truncate(footer, width))
}
