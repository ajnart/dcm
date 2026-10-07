package tui

import (
	"slices"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/service"
)

// installView is the full-screen Install surface: pick Recipes or Apps,
// search the catalog, read the details, review, install.
type installView struct {
	cursor    int
	offset    int
	picked    map[string]bool
	search    textinput.Model
	searching bool
	filter    string
	plan      *plan
	reqInputs []reviewInput
	field     int
	err       string
}

// reviewInput is one Required input with no default, asked on the review.
type reviewInput struct {
	key   string
	label string
	field textinput.Model
}

// installItem is a list row: a Recipe, an App, or a category header.
type installItem struct {
	key       string
	id        string
	name      string
	desc      string
	category  string
	installed bool
	header    bool
}

var installHelp = []key.Binding{
	hint("space", "pick"), hint("enter", "review"), hint("/", "search"), hint("esc", "back"),
}

// hint is a footer entry; it needs a key, or help treats it as disabled
// and draws nothing.
func hint(help, desc string) key.Binding {
	return key.NewBinding(key.WithKeys(help), key.WithHelp(help, desc))
}

func newInstallView(m Model) *installView {
	v := &installView{picked: map[string]bool{}}
	v.search = textinput.New()
	v.search.Prompt = "/ "
	v.search.Placeholder = "filter by name, id, description or category"
	v.resize(m.width)
	return v
}

func (v *installView) resize(width int) {
	v.search.SetWidth(max(width*2/5-6, 10))
}

func (v *installView) clamp(n int) {
	v.cursor = max(min(v.cursor, n-1), 0)
}

func (v *installView) scroll(dy, n int) {
	v.cursor += sign(dy) * 3
	v.clamp(n)
}

// installItems lists Recipes first, then Apps grouped under category headers
// and sorted by name.
func (m Model) installItems() []installItem {
	cat := m.backend.Catalog()
	installed := m.installedIDs()
	var items []installItem
	for _, r := range cat.Recipes() {
		items = append(items, installItem{key: "recipe:" + r.ID, id: r.ID, name: "📦 " + r.Name, desc: r.Description})
	}
	apps := cat.Apps()
	slices.SortFunc(apps, func(a, b app.App) int {
		return strings.Compare(strings.ToLower(a.Info().Name), strings.ToLower(b.Info().Name))
	})
	byCategory := map[string][]installItem{}
	var categories []string
	for _, a := range apps {
		info := a.Info()
		category := info.Category
		if category == "" {
			category = "Other"
		}
		if _, seen := byCategory[category]; !seen {
			categories = append(categories, category)
		}
		byCategory[category] = append(byCategory[category], installItem{
			key: "app:" + info.ID, id: info.ID, name: info.Name, desc: info.Description,
			category: category, installed: slices.Contains(installed, info.ID),
		})
	}
	slices.Sort(categories)
	for _, category := range categories {
		items = append(items, installItem{header: true, name: category})
		items = append(items, byCategory[category]...)
	}
	return items
}

// filtered narrows the list case-insensitively on name, id, description and
// category; headers disappear while a filter is active.
func (v *installView) filtered(all []installItem) []installItem {
	if v.filter == "" {
		return all
	}
	q := strings.ToLower(v.filter)
	var out []installItem
	for _, it := range all {
		if it.header {
			continue
		}
		if strings.Contains(strings.ToLower(it.name), q) ||
			strings.Contains(strings.ToLower(it.id), q) ||
			strings.Contains(strings.ToLower(it.desc), q) ||
			strings.Contains(strings.ToLower(it.category), q) {
			out = append(out, it)
		}
	}
	return out
}

func (m Model) installRows() []installItem { return m.install.filtered(m.installItems()) }

func (m Model) installedIDs() []string {
	var ids []string
	for _, a := range m.status.Apps {
		ids = append(ids, a.ID)
	}
	return ids
}

func (m Model) handleInstallKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	v := m.install
	if v.plan != nil {
		return m.handleInstallReview(msg)
	}
	if v.searching {
		switch msg.String() {
		case "enter", "down":
			v.searching = false
			return m, nil
		case "esc":
			v.searching, v.filter = false, ""
			v.search.Reset()
			v.clamp(len(m.installRows()))
			return m, nil
		}
		var cmd tea.Cmd
		v.search, cmd = v.search.Update(msg)
		v.filter = v.search.Value()
		v.clamp(len(m.installRows()))
		return m, cmd
	}
	items := m.installRows()
	switch {
	case msg.String() == "esc":
		m.surface, m.install = surfaceDashboard, nil
		return m, nil
	case key.Matches(msg, m.keys.Quit):
		m.tasks.cancelAll()
		m.stopLogs()
		return m, tea.Quit
	case key.Matches(msg, m.keys.Search):
		v.searching = true
		v.search.Focus()
		return m, textinput.Blink
	case key.Matches(msg, m.keys.Up):
		v.cursor = max(v.cursor-1, 0)
	case key.Matches(msg, m.keys.Down):
		v.cursor = min(v.cursor+1, max(len(items)-1, 0))
	case key.Matches(msg, m.keys.ScrollUp):
		v.scroll(-5, len(items))
	case key.Matches(msg, m.keys.ScrollDown):
		v.scroll(5, len(items))
	case msg.String() == "space":
		if v.cursor < len(items) && !items[v.cursor].header && !items[v.cursor].installed {
			it := items[v.cursor]
			v.picked[it.key] = !v.picked[it.key]
		}
	case msg.String() == "enter":
		return m.planPicked()
	}
	return m, nil
}

func (m Model) handleInstallReview(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	v := m.install
	reqs := v.reqInputs
	switch msg.String() {
	case "esc":
		v.plan, v.reqInputs, v.err = nil, nil, ""
		return m, nil
	case "tab", "down":
		if len(reqs) > 0 {
			reqs[v.field].field.Blur()
			v.field = (v.field + 1) % len(reqs)
			reqs[v.field].field.Focus()
		}
		return m, nil
	case "up":
		if len(reqs) > 0 {
			reqs[v.field].field.Blur()
			v.field = (v.field - 1 + len(reqs)) % len(reqs)
			reqs[v.field].field.Focus()
		}
		return m, nil
	case "enter":
		var sets []string
		for _, r := range reqs {
			value := strings.TrimSpace(r.field.Value())
			if value == "" {
				v.err = "required: " + r.label
				return m, nil
			}
			sets = append(sets, r.key+"="+value)
		}
		if len(sets) > 0 {
			v.plan.opts.Sets = append(v.plan.opts.Sets, sets...)
		}
		plan := v.plan
		m.surface, m.install = surfaceDashboard, nil
		return m.installPlan(plan)
	}
	if len(reqs) > 0 {
		var cmd tea.Cmd
		reqs[v.field].field, cmd = reqs[v.field].field.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m Model) planPicked() (tea.Model, tea.Cmd) {
	cat := m.backend.Catalog()
	var picked []string
	for k, on := range m.install.picked {
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
	var reqs []reviewInput
	for _, a := range apps {
		info := a.Info()
		opts.Targets = append(opts.Targets, info.ID)
		for _, in := range a.Inputs() {
			if in.Required && in.Default == "" {
				field := textinput.New()
				field.Prompt = ""
				field.Placeholder = in.Prompt
				field.SetWidth(max(m.width-14, 20))
				reqs = append(reqs, reviewInput{key: info.ID + "." + in.Key, label: info.Name + " · " + in.Prompt, field: field})
				continue
			}
			if in.Default != "" {
				opts.Sets = append(opts.Sets, info.ID+"."+in.Key+"="+in.Default)
			}
		}
	}
	settings := map[string]string{}
	for k, value := range m.status.Settings {
		settings[k] = value
	}
	m.install.plan = &plan{apps: apps, opts: opts, links: linksBetween(cat, apps, installed), settings: settings}
	m.install.reqInputs, m.install.err, m.install.field = reqs, "", 0
	if len(reqs) > 0 {
		reqs[0].field.Focus()
	}
	return m, nil
}

func (m Model) renderInstall() string {
	if m.install.plan != nil {
		return m.renderInstallReview(m.width)
	}
	left := max(m.width*2/5, 24)
	left = min(left, max(m.width-20, 10))
	right := m.width - left - 1
	if right < 16 {
		left, right = m.width*2/3, m.width-m.width*2/3-1
	}
	return lipgloss.JoinHorizontal(lipgloss.Top,
		m.renderInstallList(left, m.mainHeight()), m.renderInstallDetail(right, m.mainHeight()))
}

func (m Model) renderInstallList(width, height int) string {
	t := m.theme
	v := m.install
	inner := max(width-4, 1)
	var lines []string
	head := ""
	if v.searching {
		head = v.search.View()
	} else if v.filter != "" {
		head = t.dim().Render("/"+v.filter) + t.dim().Render("  (esc clears)")
	}
	if head != "" {
		lines = append(lines, truncate(head, inner), "")
	}
	avail := height - 4 - len(lines)
	if avail < 1 {
		avail = 1
	}
	items := m.installRows()
	v.cursor = max(min(v.cursor, len(items)-1), 0)
	if v.cursor < v.offset {
		v.offset = v.cursor
	}
	if v.cursor >= v.offset+avail {
		v.offset = v.cursor - avail + 1
	}
	v.offset = max(min(v.offset, max(len(items)-avail, 0)), 0)
	for i := v.offset; i < len(items) && i-v.offset < avail; i++ {
		it := items[i]
		if it.header {
			lines = append(lines, t.heading().Render(truncate(it.name, inner)))
			continue
		}
		mark := "[ ]"
		switch {
		case it.installed:
			mark = t.fg(t.ok).Render(" ✓ ")
		case v.picked[it.key]:
			mark = t.fg(t.accent).Render("[x]")
		}
		cursor := "  "
		if i == v.cursor {
			cursor = t.fg(t.accent).Bold(true).Render("> ")
		}
		line := cursor + mark + " " + t.body().Render(pad(it.name, 16)) + " " + t.dim().Render(it.id)
		lines = append(lines, truncate(line, inner))
	}
	title := t.heading().Render("Install") + t.dim().Render(" recipes & apps")
	return t.box(title, strings.Join(lines, "\n"), width, height)
}

func (m Model) renderInstallDetail(width, height int) string {
	t := m.theme
	inner := max(width-4, 1)
	items := m.installRows()
	if len(items) == 0 {
		return t.box(t.heading().Render("Details"), t.dim().Render("Nothing matches."), width, height)
	}
	it := items[min(m.install.cursor, len(items)-1)]
	if it.header {
		return t.box(t.heading().Render("Details"), t.dim().Render("Pick an App or a Recipe."), width, height)
	}
	cat := m.backend.Catalog()
	row := func(k, val string) string { return t.dim().Render(pad(k, 9)) + t.body().Render(truncate(val, inner-9)) }
	var title, body string
	if strings.HasPrefix(it.key, "recipe:") {
		r, _ := cat.Recipe(it.id)
		title = r.Name
		lines := []string{wrap(r.Description, inner), "", t.heading().Render("Apps")}
		for _, appID := range r.Apps {
			a, found := cat.App(appID)
			if !found {
				continue
			}
			info := a.Info()
			lines = append(lines, t.body().Render(info.Name)+"  "+t.dim().Render(truncate(info.Description, max(inner-lipgloss.Width(info.Name)-2, 8))))
		}
		body = strings.Join(lines, "\n")
	} else {
		a, found := cat.App(it.id)
		if !found {
			return t.box(t.heading().Render("Details"), t.dim().Render("Unknown App."), width, height)
		}
		info := a.Info()
		title = info.Name
		lines := []string{wrap(info.Description, inner), "",
			row("category", info.Category), row("image", info.Image),
			row("port", strconv.Itoa(info.Port))}
		if info.Docs != "" {
			lines = append(lines, row("docs", info.Docs))
		}
		if inputs := a.Inputs(); len(inputs) > 0 {
			lines = append(lines, "", t.heading().Render("Inputs"))
			for _, in := range inputs {
				mark := ""
				if in.Required {
					mark = " " + t.fg(t.warn).Render("required")
				}
				lines = append(lines, t.body().Render(truncate(in.Prompt, inner))+mark)
				if in.Help != "" {
					lines = append(lines, t.dim().Render(wrap(in.Help, inner)))
				}
			}
		}
		body = strings.Join(lines, "\n")
	}
	return t.box(t.heading().Render(title), body, width, height)
}

func (m Model) renderInstallReview(width int) string {
	body := m.renderPlan(m.install.plan, "enter install · esc back")
	if len(m.install.reqInputs) > 0 {
		t := m.theme
		fields := []string{"", "  " + t.heading().Render("Required inputs")}
		for i, r := range m.install.reqInputs {
			cursor := "  "
			if i == m.install.field {
				cursor = t.fg(t.accent).Render("> ")
			}
			fields = append(fields, "  "+cursor+t.dim().Render(r.label), "    "+r.field.View())
		}
		if m.install.err != "" {
			fields = append(fields, "  "+t.fg(t.fail).Render(m.install.err))
		}
		body += strings.Join(fields, "\n")
	}
	return body
}
