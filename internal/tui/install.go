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

// installView is the Catalog tab: pick Recipes or Apps, search the
// Catalog, read the details, review, install. The list and the detail take
// focus in turn; the detail scrolls.
type installView struct {
	cursor        int
	offset        int
	detailFocused bool
	detailOffset  int
	picked        picks
	search        textinput.Model
	searching     bool
	filter        string
	plan          *plan
	reqInputs     []reviewInput
	field         int
	err           string
}

// reviewInput is one Required input with no default, asked on the review.
type reviewInput struct {
	key     string
	label   string
	field   textinput.Model
	private bool
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

var (
	catalogListKeys = []key.Binding{hint("↑/↓", "select"), hint("space", "pick"), hint("enter", "review"),
		hint("/", "search"), hint("tab", "next pane"), hint("esc", "back"), hint("shift+tab", "previous pane")}
	catalogDetailKeys = []key.Binding{hint("↑/↓", "scroll"), hint("space", "pick"), hint("enter", "review"),
		hint("tab", "next pane"), hint("shift+tab", "previous pane")}
	catalogReviewKeys = []key.Binding{hint("enter", "install"), hint("esc", "back")}
	catalogInputKey   = hint("tab", "next input")
	catalogSearchKeys = []key.Binding{hint("enter", "done"), hint("esc", "clear")}
)

// hint is a bar chip or help entry; it needs a key, or help treats it as disabled
// and draws nothing.
func hint(help, desc string) key.Binding {
	return key.NewBinding(key.WithKeys(help), key.WithHelp(help, desc))
}

func newInstallView(ctx *viewContext) *installView {
	v := &installView{picked: picks{}}
	v.search = textinput.New()
	v.search.Prompt = "/ "
	v.search.Placeholder = "filter by name, id, description or category"
	v.resize(ctx.width)
	return v
}

func (v *installView) Keys() []key.Binding {
	switch {
	case v.searching:
		return catalogSearchKeys
	case v.plan != nil && len(v.reqInputs) > 1:
		return append(slices.Clone(catalogReviewKeys), catalogInputKey)
	case v.plan != nil:
		return catalogReviewKeys
	case v.detailFocused:
		return catalogDetailKeys
	}
	return catalogListKeys
}

func (v *installView) Panes() []pane {
	return []pane{{"List", catalogListKeys}, {"Detail", catalogDetailKeys}, {"Review", append(slices.Clone(catalogReviewKeys), catalogInputKey)}, {"Search", catalogSearchKeys}}
}

// Capturing is true while the search or a review's Required inputs take text.
func (v *installView) Capturing() bool {
	return v.searching || (v.plan != nil && len(v.reqInputs) > 0)
}

func (v *installView) Title() string { return "Catalog" }

func (v *installView) resize(width int) {
	v.search.SetWidth(max(width*2/5-6, 10))
}

func (v *installView) clamp(n int) {
	v.cursor = max(min(v.cursor, n-1), 0)
	v.detailOffset = 0
}

func (v *installView) scroll(dy, n int) {
	v.cursor += sign(dy) * 3
	v.clamp(n)
}

func (v *installView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		return v.key(ctx, msg)
	case tea.MouseWheelMsg:
		dy := 3
		if msg.Button == tea.MouseWheelUp {
			dy = -3
		}
		v.scroll(dy, len(v.rows(ctx)))
		return v, nil, nav{}
	}
	return v, nil, nav{}
}

func (v *installView) View(ctx *viewContext, width, height int) string {
	if v.plan != nil {
		return v.renderReview(ctx, width)
	}
	left := max(width*2/5, 24)
	left = min(left, max(width-20, 10))
	right := width - left - 1
	if right < 16 {
		left, right = width*2/3, width-width*2/3-1
	}
	return lipgloss.JoinHorizontal(lipgloss.Top,
		v.renderList(ctx, left, height), v.renderDetail(ctx, right, height))
}

// installItems lists Recipes first, then Apps grouped under category headers
// and sorted by name.
func (v *installView) installItems(ctx *viewContext) []installItem {
	cat := ctx.backend.Catalog()
	installed := v.installedIDs(ctx)
	var items []installItem
	for _, r := range cat.Recipes() {
		items = append(items, installItem{key: "recipe:" + r.ID, id: r.ID, name: ctx.glyphs.Recipe() + " " + r.Name, desc: r.Description})
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

func (v *installView) filtered(all []installItem) []installItem {
	return filterItems(all, v.filter)
}

// filterItems narrows a list of Recipes and Apps case-insensitively on name,
// id, description and category; headers disappear while a filter is active.
func filterItems(all []installItem, filter string) []installItem {
	if filter == "" {
		return all
	}
	q := strings.ToLower(filter)
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

func (v *installView) rows(ctx *viewContext) []installItem {
	return v.filtered(v.installItems(ctx))
}

func (v *installView) installedIDs(ctx *viewContext) []string {
	var ids []string
	for _, a := range ctx.status.Apps {
		ids = append(ids, a.ID)
	}
	return ids
}

func (v *installView) key(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	if v.plan != nil {
		return v.review(ctx, msg)
	}
	if v.searching {
		switch msg.String() {
		case "enter", "down":
			v.searching = false
			return v, nil, nav{}
		case "esc":
			v.searching, v.filter = false, ""
			v.search.Reset()
			v.clamp(len(v.rows(ctx)))
			return v, nil, nav{}
		}
		var cmd tea.Cmd
		v.search, cmd = v.search.Update(msg)
		v.filter = v.search.Value()
		v.clamp(len(v.rows(ctx)))
		return v, cmd, nav{}
	}
	items := v.rows(ctx)
	switch {
	case msg.String() == "esc":
		return v, nil, nav{kind: navBack}
	case key.Matches(msg, ctx.keys.Search):
		v.searching = true
		v.search.Focus()
		return v, textinput.Blink, nav{}
	case key.Matches(msg, ctx.keys.NextPane), key.Matches(msg, ctx.keys.PrevPane):
		v.detailFocused = !v.detailFocused
	case key.Matches(msg, ctx.keys.Up) && v.detailFocused:
		v.detailOffset = max(v.detailOffset-1, 0)
	case key.Matches(msg, ctx.keys.Down) && v.detailFocused:
		v.detailOffset++
	case key.Matches(msg, ctx.keys.Up):
		v.cursor = max(v.cursor-1, 0)
		v.detailOffset = 0
	case key.Matches(msg, ctx.keys.Down):
		v.cursor = min(v.cursor+1, max(len(items)-1, 0))
		v.detailOffset = 0
	case key.Matches(msg, ctx.keys.ScrollUp):
		v.scroll(-5, len(items))
	case key.Matches(msg, ctx.keys.ScrollDown):
		v.scroll(5, len(items))
	case msg.String() == "space":
		if v.cursor < len(items) && !items[v.cursor].header {
			v.picked.toggle(ctx.backend.Catalog(), items[v.cursor].key, v.installedIDs(ctx))
		}
	case msg.String() == "enter":
		return v.planPicked(ctx)
	}
	return v, nil, nav{}
}

func (v *installView) review(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	reqs := v.reqInputs
	switch msg.String() {
	case "esc":
		v.plan, v.reqInputs, v.err = nil, nil, ""
		return v, nil, nav{}
	case "tab", "down":
		if len(reqs) > 0 {
			reqs[v.field].field.Blur()
			v.field = (v.field + 1) % len(reqs)
			reqs[v.field].field.Focus()
		}
		return v, nil, nav{}
	case "up":
		if len(reqs) > 0 {
			reqs[v.field].field.Blur()
			v.field = (v.field - 1 + len(reqs)) % len(reqs)
			reqs[v.field].field.Focus()
		}
		return v, nil, nav{}
	case "enter":
		var sets []string
		for _, r := range reqs {
			value := r.field.Value()
			if strings.TrimSpace(value) == "" {
				v.err = "required: " + r.label
				return v, nil, nav{}
			}
			if r.private {
				id, key, _ := strings.Cut(r.key, ".")
				setPrivateInput(&v.plan.opts, id, key, value)
				continue
			}
			sets = append(sets, r.key+"="+strings.TrimSpace(value))
		}
		if len(sets) > 0 {
			v.plan.opts.Sets = append(v.plan.opts.Sets, sets...)
		}
		opts := v.plan.opts
		return v, ctx.run(Request{Action: ActionInstall, Install: &opts}, "install "+strings.Join(opts.Targets, " ")), nav{kind: navDone}
	}
	if len(reqs) > 0 {
		var cmd tea.Cmd
		reqs[v.field].field, cmd = reqs[v.field].field.Update(msg)
		return v, cmd, nav{}
	}
	return v, nil, nav{}
}

func (v *installView) planPicked(ctx *viewContext) (view, tea.Cmd, nav) {
	cat := ctx.backend.Catalog()
	installed := v.installedIDs(ctx)
	var apps []app.App
	for _, a := range v.picked.apps(cat) {
		if !slices.Contains(installed, a.Info().ID) {
			apps = append(apps, a)
		}
	}
	if len(apps) == 0 {
		ctx.setFlash("pick Apps with space first", levelWarn)
		return v, nil, nav{}
	}
	opts := service.InstallOptions{}
	var reqs []reviewInput
	for _, a := range apps {
		info := a.Info()
		opts.Targets = append(opts.Targets, info.ID)
		for _, in := range a.Inputs() {
			defaultValue := in.Default
			if in.Private {
				defaultValue = ""
			}
			if in.Required && defaultValue == "" {
				field := textinput.New()
				if in.Private {
					field.EchoMode = textinput.EchoPassword
				}
				field.Prompt = ""
				field.Placeholder = in.Prompt
				field.SetWidth(max(ctx.width-14, 20))
				reqs = append(reqs, reviewInput{key: info.ID + "." + in.Key, label: info.Name + " · " + in.Prompt, field: field, private: in.Private})
				continue
			}
			if defaultValue != "" {
				opts.Sets = append(opts.Sets, info.ID+"."+in.Key+"="+defaultValue)
			}
		}
	}
	settings := map[string]string{}
	for k, value := range ctx.status.Settings {
		settings[k] = value
	}
	v.plan = &plan{apps: apps, opts: opts, links: linksBetween(cat, apps, installed), settings: settings,
		privateAccess: slices.Contains(ctx.status.Access, "tailscale") && !slices.Contains(opts.Targets, "tailscale")}
	v.reqInputs, v.err, v.field = reqs, "", 0
	if len(reqs) > 0 {
		reqs[0].field.Focus()
	}
	return v, nil, nav{}
}

func (v *installView) renderList(ctx *viewContext, width, height int) string {
	t := ctx.theme
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
	items := v.rows(ctx)
	v.cursor = max(min(v.cursor, len(items)-1), 0)
	if v.cursor < v.offset {
		v.offset = v.cursor
	}
	if v.cursor >= v.offset+avail {
		v.offset = v.cursor - avail + 1
	}
	v.offset = max(min(v.offset, max(len(items)-avail, 0)), 0)
	nameW := 16
	for _, it := range items {
		if !it.header {
			nameW = max(nameW, lipgloss.Width(it.name))
		}
	}
	nameW = min(nameW, max(inner-8, 8))
	for i := v.offset; i < len(items) && i-v.offset < avail; i++ {
		it := items[i]
		if it.header {
			lines = append(lines, truncate(t.dim().Render(ctx.glyphs.Category(it.name))+" "+t.heading().Render(it.name), inner))
			continue
		}
		mark := t.dim().Render(" " + pickNone.glyph() + " ")
		switch {
		case it.installed:
			mark = t.fg(t.ok).Render(" ✓ ")
		case strings.HasPrefix(it.key, "recipe:"):
			r, _ := ctx.backend.Catalog().Recipe(it.id)
			recipe := v.picked.recipeMark(r, v.installedIDs(ctx))
			mark = t.dim().Render(" " + recipe.glyph() + " ")
			if recipe != pickNone {
				mark = t.title().Render(" " + recipe.glyph() + " ")
			}
		case v.picked[it.id]:
			mark = t.title().Render(" " + pickAll.glyph() + " ")
		}
		cursor := "  "
		if i == v.cursor {
			cursor = t.cursor()
		}
		line := cursor + mark + " " + t.body().Render(pad(it.name, nameW))
		if room := inner - lipgloss.Width(line) - 1; room >= lipgloss.Width(it.id) {
			line += " " + t.dim().Render(it.id)
		}
		lines = append(lines, truncate(line, inner))
	}
	return t.box("Catalog", "Recipes and Apps", strings.Join(lines, "\n"), width, height, !v.detailFocused)
}

func (v *installView) renderDetail(ctx *viewContext, width, height int) string {
	t := ctx.theme
	inner := max(width-4, 1)
	items := v.rows(ctx)
	if len(items) == 0 {
		return t.box("Details", "", t.dim().Render("Nothing matches."), width, height, v.detailFocused)
	}
	it := items[min(v.cursor, len(items)-1)]
	if it.header {
		return t.box("Details", "", t.dim().Render("Pick an App or a Recipe."), width, height, v.detailFocused)
	}
	cat := ctx.backend.Catalog()
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
			return t.box("Details", "", t.dim().Render("Unknown App."), width, height, v.detailFocused)
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
	lines := strings.Split(body, "\n")
	v.detailOffset = min(v.detailOffset, max(len(lines)-(height-2), 0))
	return t.box(title, "", strings.Join(lines[v.detailOffset:], "\n"), width, height, v.detailFocused)
}

func (v *installView) renderReview(ctx *viewContext, width int) string {
	body := renderPlan(ctx.theme, v.plan, "", width)
	if len(v.reqInputs) > 0 {
		t := ctx.theme
		fields := []string{"", "  " + t.heading().Render("Required inputs")}
		for i, r := range v.reqInputs {
			cursor := "  "
			if i == v.field {
				cursor = t.cursor()
			}
			fields = append(fields, "  "+cursor+t.dim().Render(r.label), "    "+r.field.View())
		}
		if v.err != "" {
			fields = append(fields, "  "+t.fg(t.fail).Render(v.err))
		}
		body += strings.Join(fields, "\n")
	}
	return body
}
