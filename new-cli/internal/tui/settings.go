package tui

import (
	"errors"
	"net"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/ajnart/self-host/internal/service"
)

// settingsKeys is every Host setting the Settings view edits, in the order
// ConfigSet receives them.
var settingsKeys = []string{"EXPOSURE", "LAN_IP", "TZ", "PUID", "PGID", "UMASK", "MEDIA_ROOT", "DOWNLOADS_ROOT"}

// settingsView is the Settings tab, a single pane: every Host setting is
// editable, with drift shown and pending changes applied at once.
type settingsView struct {
	cursor int
	rows   []service.SettingReview
	edits  map[string]string

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
		hint("↑/↓", "select"), hint("enter", "edit"), hint("ctrl+s", "apply"), hint("esc", "back"),
	}
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
	}
	return settingsHelp
}

func (v *settingsView) Panes() []pane {
	return []pane{{"Host settings", settingsHelp}, {"Editing", append(slices.Clone(settingsEditKeys), settingsChoiceKey)}}
}

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
	case tea.MouseWheelMsg:
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
	case msg.String() == "esc":
		if len(v.pairs()) > 0 {
			v.confirmDiscard = true
			return v, nil, nav{}
		}
		return v, nil, nav{kind: navBack}
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

func (v *settingsView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	inner := max(width-4, 12)
	var lines []string
	lines = append(lines, "", "  "+t.title().Render("Host settings")+t.dim().Render("  enter/space edits · ctrl+s applies · esc back"))
	if v.err != "" {
		lines = append(lines, "  "+t.fg(t.fail).Render(v.err))
	}
	lines = append(lines, "")
	for i := range v.rows {
		lines = append(lines, "  "+v.renderRow(ctx, i, inner))
	}
	if pairs := len(v.pairs()); pairs > 0 {
		lines = append(lines, "", "  "+t.heading().Render("Pending changes")+t.dim().Render(" "+strconv.Itoa(pairs)))
		for i := range v.rows {
			if !v.changed(i) {
				continue
			}
			lines = append(lines, "  "+t.body().Render(pad(v.rows[i].Key, 16))+
				t.dim().Render(v.rows[i].Current+" → ")+t.fg(t.accentText).Render(v.value(i)))
		}
		if v.hasKey("PUID") || v.hasKey("PGID") {
			lines = append(lines, "  "+t.fg(t.warn).Render("! PUID/PGID changes who owns the installed Apps' files"))
		}
		lines = append(lines, "  "+t.dim().Render("Apps that use a changed setting are recreated."))
	}
	if v.confirmDiscard {
		lines = append(lines, "", "  "+t.fg(t.warn).Render("discard "+strconv.Itoa(len(v.pairs()))+" changes? y/n"))
	}
	return strings.Join(lines, "\n")
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
