package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
)

// helpView is the key reference, opened as an overlay over the active view.
type helpView struct {
	vp viewport.Model
}

func newHelpView() *helpView { return &helpView{vp: viewport.New()} }

func (v *helpView) Keys() []key.Binding {
	k := newKeyMap()
	return []key.Binding{k.Up, k.Down, k.ScrollUp, k.ScrollDown, k.Back}
}

func (v *helpView) Title() string { return "Keys" }

// open sizes the viewport and lays the key reference into it.
func (v *helpView) open(ctx *viewContext) {
	v.vp.SetWidth(max(min(ctx.width-10, 92), 20))
	v.vp.SetHeight(max(min(ctx.height-8, 30), 5))
	h := ctx.help
	h.SetWidth(max(v.vp.Width(), 20))
	body := h.FullHelpView(ctx.keys.FullHelp()) + "\n\n" +
		"More: self-host --help (remove, restore, config, credentials…)"
	if ctx.latest != "" {
		body += "\n\n" + releaseNotice(ctx.latest)
	}
	v.vp.SetContent(body)
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
