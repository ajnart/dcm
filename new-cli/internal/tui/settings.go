package tui

import (
	"context"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/service"
)

// settingsKeys is every Host setting the Settings view edits, in the order
// ConfigSet receives them.
var settingsKeys = []string{"EXPOSURE", "LAN_IP", "TZ", "PUID", "PGID", "UMASK", "MEDIA_ROOT", "DOWNLOADS_ROOT"}

// settingsTab is one sub-tab of Settings.
type settingsTab int

const (
	tabHost settingsTab = iota
	tabAppearance
	tabBackups
	tabTools
	tabAbout
)

var settingsTabs = []string{"Host", "Appearance", "Backups", "Tools", "About"}

// settingsView is the Settings tab, in sub-tabs. Host edits every Host
// setting, with drift shown and pending changes applied at once; Appearance
// chooses the glyph set, saved as soon as it is chosen; About says what runs
// and where to support it. Backups and Tools are placeholders.
type settingsView struct {
	tab    settingsTab
	cursor int
	// offset is the first Host setting row on screen.
	offset int
	// glyphCursor is Appearance's highlighted choice, an index into
	// glyphChoices.
	glyphCursor int
	rows        []service.SettingReview
	edits       map[string]string

	editing bool
	key     string
	input   textinput.Model

	choices   []string
	choiceIdx int

	err            string
	confirmDiscard bool
}

var (
	settingsHelp = []key.Binding{
		hint("↑/↓", "select"), hint("enter", "edit"), hint("ctrl+s", "apply"), hint("[/]", "sub-tab"), hint("esc", "back"),
	}
	appearanceKeys = []key.Binding{
		hint("↑/↓", "select"), hint("enter", "choose"), hint("[/]", "sub-tab"), hint("esc", "back"),
	}
	aboutKeys = []key.Binding{
		hint("c", "coffee"), hint("s", "sponsor"), hint("[/]", "sub-tab"), hint("esc", "back"),
	}
	placeholderKeys   = []key.Binding{hint("[/]", "sub-tab"), hint("esc", "back")}
	settingsEditKeys  = []key.Binding{hint("enter", "accept"), hint("esc", "cancel")}
	settingsChoiceKey = hint("tab", "next choice")
)

func newSettingsView(ctx *viewContext) *settingsView {
	v := &settingsView{edits: map[string]string{}}
	for _, key := range settingsKeys {
		v.rows = append(v.rows, service.SettingReview{Key: key, Current: settingCurrent(ctx, key)})
	}
	return v
}

func (v *settingsView) Keys() []key.Binding {
	switch {
	case v.editing && len(v.choices) > 1:
		return append(slices.Clone(settingsEditKeys), settingsChoiceKey)
	case v.editing:
		return settingsEditKeys
	case v.tab == tabAppearance:
		return appearanceKeys
	case v.tab == tabAbout:
		return aboutKeys
	case v.tab != tabHost:
		return placeholderKeys
	}
	return settingsHelp
}

func (v *settingsView) Panes() []pane {
	return []pane{{"Host settings", settingsHelp}, {"Appearance", appearanceKeys}, {"About", aboutKeys},
		{"Editing", append(slices.Clone(settingsEditKeys), settingsChoiceKey)}}
}

type glyphChoice struct {
	glyphs  activity.Glyphs
	explain string
}

// glyphChoices are the glyph sets the Appearance pane offers, with the one
// line that explains each.
var glyphChoices = []glyphChoice{
	{activity.NerdFont, "richer icons, drawn by a Nerd Font installed in your terminal"},
	{activity.Simple, "plain Unicode symbols that every terminal font can draw"},
}

const nerdFontsURL = "https://www.nerdfonts.com"

func (v *settingsView) Capturing() bool { return v.editing }

func (v *settingsView) Title() string { return "Settings" }

func settingCurrent(ctx *viewContext, key string) string {
	switch key {
	case "EXPOSURE":
		return ctx.status.Exposure
	case "LAN_IP":
		return ctx.status.LANIP
	default:
		return ctx.status.Settings[key]
	}
}

// apply merges a fresh Host review into the rows.
func (v *settingsView) apply(rows []service.SettingReview, err error) {
	if err != nil {
		v.err = err.Error()
		return
	}
	v.err = ""
	byKey := map[string]service.SettingReview{}
	for _, row := range rows {
		byKey[row.Key] = row
	}
	for i := range v.rows {
		row, found := byKey[v.rows[i].Key]
		if !found {
			continue
		}
		v.rows[i].Detected, v.rows[i].Drift = row.Detected, row.Drift
		v.rows[i].Note, v.rows[i].Choices = row.Note, row.Choices
		if row.Current != "" && !v.changed(i) {
			v.rows[i].Current = row.Current
		}
	}
}

func (v *settingsView) value(i int) string {
	if value, found := v.edits[v.rows[i].Key]; found {
		return value
	}
	return v.rows[i].Current
}

func (v *settingsView) changed(i int) bool {
	value, found := v.edits[v.rows[i].Key]
	return found && value != v.rows[i].Current
}

func (v *settingsView) clamp() {
	v.cursor = max(min(v.cursor, len(v.rows)-1), 0)
}

// pairs are the changed settings as KEY=value, in settingsKeys order.
func (v *settingsView) pairs() []string {
	var out []string
	for i := range v.rows {
		if value, found := v.edits[v.rows[i].Key]; found && value != v.rows[i].Current {
			out = append(out, v.rows[i].Key+"="+value)
		}
	}
	return out
}

func (v *settingsView) hasKey(key string) bool {
	for i := range v.rows {
		if v.rows[i].Key == key && v.changed(i) {
			return true
		}
	}
	return false
}

func validateSetting(key, value string) error {
	switch key {
	case "PUID", "PGID":
		if _, err := strconv.Atoi(value); err != nil {
			return errors.New("digits only")
		}
	case "UMASK":
		if len(value) != 3 {
			return errors.New("3 octal digits")
		}
		if _, err := strconv.ParseUint(value, 8, 16); err != nil {
			return errors.New("3 octal digits")
		}
	case "MEDIA_ROOT", "DOWNLOADS_ROOT":
		if !filepath.IsAbs(value) {
			return errors.New("an absolute path")
		}
	case "LAN_IP":
		ip := net.ParseIP(value)
		if ip == nil || ip.To4() == nil {
			return errors.New("an IPv4 address")
		}
	case "TZ":
		if strings.TrimSpace(value) == "" {
			return errors.New("a time zone")
		}
	}
	return nil
}

func (v *settingsView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		return v.handleKey(ctx, msg)
	case clickMsg:
		var n int
		if _, err := fmt.Sscanf(msg.id, "tab:%d", &n); err == nil && n >= 0 && n < len(settingsTabs) {
			v.show(ctx, settingsTab(n))
		}
		return v, nil, nav{}
	case tea.MouseWheelMsg:
		if v.tab != tabHost {
			return v, nil, nav{}
		}
		dy := 1
		if msg.Button == tea.MouseWheelUp {
			dy = -1
		}
		v.cursor += dy
		v.clamp()
		return v, nil, nav{}
	}
	return v, nil, nav{}
}

func (v *settingsView) handleKey(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	if v.confirmDiscard {
		switch msg.String() {
		case "y", "Y":
			return v, nil, nav{kind: navDone}
		case "n", "N", "esc":
			v.confirmDiscard = false
		}
		return v, nil, nav{}
	}
	if v.editing {
		switch msg.String() {
		case "esc":
			v.editing, v.err = false, ""
			return v, nil, nav{}
		case "tab":
			v.cycleChoice()
			return v, nil, nav{}
		case "enter":
			value := strings.TrimSpace(v.input.Value())
			if err := validateSetting(v.key, value); err != nil {
				v.err = v.key + ": " + err.Error()
				return v, nil, nav{}
			}
			v.edits[v.key] = value
			v.editing, v.err = false, ""
			return v, nil, nav{}
		}
		var cmd tea.Cmd
		v.input, cmd = v.input.Update(msg)
		return v, cmd, nav{}
	}
	switch {
	case key.Matches(msg, ctx.keys.NextSub):
		v.show(ctx, (v.tab+1)%settingsTab(len(settingsTabs)))
		return v, nil, nav{}
	case key.Matches(msg, ctx.keys.PrevSub):
		v.show(ctx, (v.tab+settingsTab(len(settingsTabs))-1)%settingsTab(len(settingsTabs)))
		return v, nil, nav{}
	case msg.String() == "esc":
		if len(v.pairs()) > 0 {
			v.tab, v.confirmDiscard = tabHost, true
			return v, nil, nav{}
		}
		return v, nil, nav{kind: navBack}
	}
	switch v.tab {
	case tabHost:
		return v.hostKey(ctx, msg)
	case tabAppearance:
		return v, v.appearanceKey(ctx, msg), nav{}
	case tabAbout:
		return v, v.aboutKey(ctx, msg), nav{}
	}
	return v, nil, nav{}
}

// show opens a sub-tab; Appearance starts on the glyph set in use.
func (v *settingsView) show(ctx *viewContext, tab settingsTab) {
	v.tab = tab
	if tab == tabAppearance {
		v.glyphCursor = slices.IndexFunc(glyphChoices, func(c glyphChoice) bool { return c.glyphs == ctx.glyphs })
	}
}

func (v *settingsView) hostKey(ctx *viewContext, msg tea.KeyPressMsg) (view, tea.Cmd, nav) {
	switch {
	case key.Matches(msg, ctx.keys.Apply):
		pairs := v.pairs()
		if len(pairs) == 0 {
			ctx.setFlash("no pending changes", levelInfo)
			return v, nil, nav{}
		}
		return v, ctx.run(Request{Action: ActionConfig, Pairs: pairs}, "config "+strings.Join(pairs, " ")), nav{kind: navDone}
	case key.Matches(msg, ctx.keys.Up):
		v.cursor = max(v.cursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		v.cursor = min(v.cursor+1, len(v.rows)-1)
	case msg.String() == "enter", msg.String() == "space":
		return v.beginEdit(ctx)
	}
	return v, nil, nav{}
}

// aboutKey opens a donation page: c Ko-fi, s GitHub Sponsors.
func (v *settingsView) aboutKey(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "c":
		return openLink(ctx.backend, koFiURL)
	case "s":
		return openLink(ctx.backend, sponsorsURL)
	}
	return nil
}

func openLink(backend Backend, url string) tea.Cmd {
	return func() tea.Msg {
		if err := backend.OpenURL(url); err != nil {
			return flashMsg{text: "could not open a browser: " + err.Error() + " — " + url, level: levelError}
		}
		return flashMsg{text: "opened " + url, level: levelOK}
	}
}

// appearanceKey moves the highlight between the glyph sets, and enter or
// space uses the highlighted one: the whole UI redraws with it at once and
// it is saved with the Project.
func (v *settingsView) appearanceKey(ctx *viewContext, msg tea.KeyPressMsg) tea.Cmd {
	switch {
	case key.Matches(msg, ctx.keys.Up):
		v.glyphCursor = max(v.glyphCursor-1, 0)
	case key.Matches(msg, ctx.keys.Down):
		v.glyphCursor = min(v.glyphCursor+1, len(glyphChoices)-1)
	case msg.String() == "enter", msg.String() == "space":
		chosen := glyphChoices[v.glyphCursor].glyphs
		if chosen == ctx.glyphs {
			return nil
		}
		ctx.glyphs = chosen
		return saveGlyphs(ctx.backend, chosen)
	}
	return nil
}

func saveGlyphs(backend Backend, g activity.Glyphs) tea.Cmd {
	return func() tea.Msg {
		if err := backend.SetGlyphs(context.Background(), g); err != nil {
			return flashMsg{text: "could not save the icons: " + err.Error(), level: levelError}
		}
		return flashMsg{text: "icons: " + g.Label() + " (saved)", level: levelOK}
	}
}

func (v *settingsView) beginEdit(ctx *viewContext) (view, tea.Cmd, nav) {
	row := v.rows[v.cursor]
	if row.Key == "EXPOSURE" {
		value := service.ExposureLAN
		if v.value(v.cursor) == service.ExposureLAN {
			value = service.ExposureLocal
		}
		v.edits[row.Key] = value
		return v, nil, nav{}
	}
	v.editing, v.key, v.err = true, row.Key, ""
	if row.Key == "LAN_IP" && len(row.Choices) > 1 {
		v.choices = row.Choices
		v.choiceIdx = max(slices.Index(v.choices, v.value(v.cursor)), 0)
	} else {
		v.choices = nil
	}
	v.input = textinput.New()
	v.input.Prompt = ""
	v.input.SetValue(v.value(v.cursor))
	v.input.CursorEnd()
	v.input.SetWidth(max(ctx.width-24, 20))
	v.input.Focus()
	return v, textinput.Blink, nav{}
}

func (v *settingsView) cycleChoice() {
	if len(v.choices) < 2 {
		return
	}
	v.choiceIdx = (v.choiceIdx + 1) % len(v.choices)
	v.input.SetValue(v.choices[v.choiceIdx])
	v.input.CursorEnd()
}

// minRows is the fewest Host setting rows the pane keeps on screen.
const minRows = 3

// View draws the sub-tab strip above the open sub-tab's box. The Host
// settings rows scroll to keep the cursor in view, and the pending changes
// shrink before the rows do.
func (v *settingsView) View(ctx *viewContext, width, height int) string {
	strip, layers := subTabStrip(ctx.theme, settingsTabs, int(v.tab), 1, 1)
	ctx.layers = append(ctx.layers, layers...)
	var body string
	switch v.tab {
	case tabHost:
		body = v.hostBox(ctx, width, max(height-3, 3))
	case tabAppearance:
		body = v.appearanceBox(ctx, width)
	case tabAbout:
		body = aboutBox(ctx, width)
	default:
		body = placeholderBox(ctx.theme, settingsTabs[v.tab], width)
	}
	return truncate(strip, width) + "\n" + body
}

// placeholderBox stands in for a sub-tab that is not built yet.
func placeholderBox(t theme, title string, width int) string {
	return t.box(title, "", "  "+t.dim().Render("Coming in the next update."), width, 3, true)
}

// aboutBox is the version, the Project folder, the update status and the two
// ways to support self-host, each as a key and as a terminal link.
func aboutBox(ctx *viewContext, width int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	row := func(name, value string) string {
		return truncate("  "+t.dim().Render(pad(name, 16))+value, inner)
	}
	entry := func(key, label, url string) string {
		return "  " + t.title().Render(key) + "  " + t.body().Render(pad(label, 20)) +
			ansi.SetHyperlink(url) + t.fg(t.info).Render(url) + ansi.ResetHyperlink()
	}
	lines := []string{
		row("Version", t.body().Render("v"+strings.TrimPrefix(ctx.version, "v"))),
		row("Project folder", t.body().Render(ctx.status.Project)),
		row("Updates", updateStatus(ctx)),
		"",
		"  " + t.dim().Render("Like self-host? Help keep it going."),
		entry("c", "buy us a coffee", koFiURL),
		entry("s", "sponsor on GitHub", sponsorsURL),
	}
	return t.box("About", "", strings.Join(lines, "\n"), width, len(lines)+2, true)
}

// updateStatus is what the release check found: a newer release, none, or
// nothing yet.
func updateStatus(ctx *viewContext) string {
	t := ctx.theme
	switch {
	case ctx.latest != "":
		return t.fg(t.info).Render("↑ " + releaseNotice(ctx.latest))
	case ctx.releaseChecked:
		return t.fg(t.ok).Render("✓ up to date")
	}
	return t.dim().Render("? not checked")
}

// hostBox draws the Host settings, sized to its content within avail lines.
func (v *settingsView) hostBox(ctx *viewContext, width, avail int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	var head, confirm []string
	if v.err != "" {
		head = []string{t.fg(t.fail).Render(v.err)}
	}
	if v.confirmDiscard {
		confirm = []string{t.fg(t.warn).Render("discard " + strconv.Itoa(len(v.pairs())) + " changes? y/n")}
	}
	space := avail - len(head) - len(confirm)
	window := min(len(v.rows), max(minRows, space-v.pendingHeight()))
	pending := v.pendingLines(ctx, max(space-window, 0))
	window = min(len(v.rows), max(space-len(pending), 1))
	v.scrollTo(window)

	lines := head
	for i := v.offset; i < v.offset+window && i < len(v.rows); i++ {
		lines = append(lines, v.renderRow(ctx, i, inner))
	}
	lines = append(lines, pending...)
	lines = append(lines, confirm...)
	note := ""
	if n := len(v.pairs()); n > 0 {
		note = strconv.Itoa(n) + " pending"
	}
	return t.box("Host settings", note, strings.Join(lines, "\n"), width, len(lines)+2, true)
}

// scrollTo keeps the cursor inside a window of rows.
func (v *settingsView) scrollTo(window int) {
	if v.cursor < v.offset {
		v.offset = v.cursor
	}
	if v.cursor >= v.offset+window {
		v.offset = v.cursor - window + 1
	}
	v.offset = max(min(v.offset, len(v.rows)-window), 0)
}

// pendingNotes are the lines that follow the pending changes: a warning when
// file ownership changes, and the note that Apps are recreated.
func (v *settingsView) pendingNotes(t theme) []string {
	var notes []string
	if v.hasKey("PUID") || v.hasKey("PGID") {
		notes = append(notes, "  "+t.fg(t.warn).Render("! PUID/PGID changes who owns the installed Apps' files"))
	}
	return append(notes, "  "+t.dim().Render("Apps that use a changed setting are recreated."))
}

// pendingHeight is how many lines the pending changes take whole: a blank
// line, the heading, every change and the notes; none without changes.
func (v *settingsView) pendingHeight() int {
	pairs := len(v.pairs())
	if pairs == 0 {
		return 0
	}
	notes := 1
	if v.hasKey("PUID") || v.hasKey("PGID") {
		notes++
	}
	return 2 + pairs + notes
}

// pendingLines are the pending changes in at most limit lines: the heading
// and as many changes as fit, then "…" for the rest, with the notes only
// when there is room for everything.
func (v *settingsView) pendingLines(ctx *viewContext, limit int) []string {
	t := ctx.theme
	pairs := len(v.pairs())
	if pairs == 0 || limit < 3 {
		return nil
	}
	lines := []string{"", t.heading().Render("Pending changes") + t.dim().Render(" "+strconv.Itoa(pairs))}
	var changes []string
	for i := range v.rows {
		if v.changed(i) {
			changes = append(changes, "  "+t.body().Render(pad(v.rows[i].Key, 16))+
				t.dim().Render(v.rows[i].Current+" → ")+t.fg(t.accentText).Render(v.value(i)))
		}
	}
	if v.pendingHeight() <= limit {
		return append(append(lines, changes...), v.pendingNotes(t)...)
	}
	room := limit - len(lines)
	if len(changes) > room {
		changes = append(changes[:room-1], "  "+t.dim().Render("…"))
	}
	return append(lines, changes...)
}

// appearanceBox draws the Appearance pane: a sample line of the icons in the
// current set, the choice of set, and where to learn about Nerd Fonts.
func (v *settingsView) appearanceBox(ctx *viewContext, width int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	g := ctx.glyphs
	lines := []string{truncate("  "+t.dim().Render(pad("Sample", 13))+glyphSample(t, g), inner)}
	for i, choice := range glyphChoices {
		cursor := "  "
		if i == v.glyphCursor {
			cursor = t.cursor()
		}
		mark := t.dim().Render("○")
		name := t.body().Render(pad(choice.glyphs.Label(), 11))
		if choice.glyphs == g {
			mark = t.fg(t.accentText).Render("●")
			name = t.active().Render(pad(choice.glyphs.Label(), 11))
		}
		lines = append(lines, truncate(cursor+mark+" "+name+t.dim().Render(choice.explain), inner))
	}
	lines = append(lines, "", nerdFontsLine(t))
	return t.box("Appearance", "saved at once", strings.Join(lines, "\n"), width, len(lines)+2, true)
}

// glyphSample is a line of the icons of a glyph set, each with its meaning.
func glyphSample(t theme, g activity.Glyphs) string {
	icon := func(glyph, label string) string {
		return t.fg(t.accentText).Render(glyph) + " " + t.body().Render(label)
	}
	return strings.Join([]string{icon(g.Brand(), "self-host"), icon(g.Docker(), "Docker"), icon(g.Key(), "key"),
		icon(g.Link(), "link"), icon(g.Category("Media"), "Media"), icon(g.Category("Downloads"), "Downloads"),
		icon(g.Category("Monitoring"), "Monitoring")}, "  ")
}

// nerdFontsLine points at where to learn about Nerd Fonts, as text and as a
// terminal link.
func nerdFontsLine(t theme) string {
	link := ansi.SetHyperlink(nerdFontsURL) + t.fg(t.info).Render(nerdFontsURL) + ansi.ResetHyperlink()
	return t.dim().Render("Learn about Nerd Fonts: ") + link
}

func (v *settingsView) renderRow(ctx *viewContext, i, width int) string {
	t := ctx.theme
	row := v.rows[i]
	cursor := "  "
	if i == v.cursor {
		cursor = t.cursor()
	}
	line := cursor + t.body().Render(pad(row.Key, 16))
	if v.editing && i == v.cursor {
		line += v.input.View()
	} else {
		line += t.body().Render(pad(v.value(i), 22))
		if row.Detected != "" && row.Detected != v.value(i) {
			line += t.dim().Render("detected " + row.Detected)
		}
	}
	switch {
	case v.changed(i):
		line += t.fg(t.accentText).Render(" (pending)")
	case row.Drift:
		note := row.Note
		if note == "" {
			note = "differs from this machine"
		}
		line += " " + t.fg(t.warn).Render("⚠ "+note)
	}
	return truncate(line, width)
}
