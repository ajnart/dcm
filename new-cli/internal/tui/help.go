package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
)

// helpView is the key reference, opened as an overlay over the active tab.
type helpView struct {
	vp viewport.Model
}

var helpKeys = []key.Binding{hint("↑/↓", "scroll"), hint("pgup/pgdn", "page")}

func newHelpView() *helpView { return &helpView{vp: viewport.New()} }

func (v *helpView) Keys() []key.Binding { return helpKeys }

func (v *helpView) Panes() []pane { return []pane{{"Keys", helpKeys}} }

func (v *helpView) Capturing() bool { return false }

func (v *helpView) Title() string { return "Keys" }

// open sizes the viewport and lays the key reference into it, one group
// per pane: the global keys first, then each tab's panes.
func (v *helpView) open(ctx *viewContext, groups []pane) {
	v.vp.SetWidth(max(min(ctx.width-10, 92), 20))
	v.vp.SetHeight(max(ctx.height-8, 5))
	t := ctx.theme
	var lines []string
	if ctx.latest != "" {
		lines = append(lines, t.fg(t.info).Render(releaseNotice(ctx.latest)), "")
	}
	for _, group := range groups {
		lines = append(lines, t.heading().Render(group.name))
		for _, b := range group.keys {
			lines = append(lines, "  "+t.title().Render(pad(b.Help().Key, 11))+" "+t.body().Render(b.Help().Desc))
		}
		lines = append(lines, "")
	}
	lines = append(lines,
		t.dim().Render("Up, Down and Restart all: click UP, DOWN or RESTART on the Apps tab."),
		t.dim().Render("More: self-host --help (remove, restore, config, credentials…)"))
	v.vp.SetContent(strings.Join(lines, "\n"))
	v.vp.GotoTop()
}

func (v *helpView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	press, ok := msg.(tea.KeyPressMsg)
	if !ok {
		return v, nil, nav{}
	}
	k := ctx.keys
	switch {
	case key.Matches(press, k.Up):
		v.vp.ScrollUp(1)
	case key.Matches(press, k.Down):
		v.vp.ScrollDown(1)
	case key.Matches(press, k.ScrollUp):
		v.vp.PageUp()
	case key.Matches(press, k.ScrollDown):
		v.vp.PageDown()
	default:
		return v, nil, nav{kind: navBack}
	}
	return v, nil, nav{}
}

func (v *helpView) View(ctx *viewContext, width, height int) string {
	t := ctx.theme
	overlayWidth := max(min(width-6, 100), 20)
	body := t.title().Render("Keys") + "\n\n" + v.vp.View() + "\n\n" +
		t.dim().Render("↑/↓ scroll · any other key closes")
	return t.panel(true).Render(clip(body, overlayWidth))
}

func releaseNotice(latest string) string {
	return "v" + strings.TrimPrefix(latest, "v") + " is available: run self-host self-update"
}
