package tui

import (
	"strings"

	"charm.land/bubbles/v2/key"
	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

// helpView is the key reference, opened as an overlay over the active tab.
// It also shows a help page, the longer explanation of what is focused,
// which fills the tab's place instead.
type helpView struct {
	vp viewport.Model
	// page is the open help page; nil while the key reference is open.
	page *helpPage
}

// helpPage is a longer explanation of the focused thing, as the lines that
// fit a width. Each Access option has one, in Onboarding's Access step and Settings' Access sub-tab.
type helpPage struct {
	title    string
	lines    func(t theme, width int) []string
	copyText string
}

const (
	repositoryURL = "https://github.com/ajnart/selfhost-skills"
	koFiURL       = "https://ko-fi.com/ajnart"
	sponsorsURL   = "https://github.com/sponsors/ajnart"
)

var (
	helpKeys = []key.Binding{hint("↑/↓", "scroll"), hint("pgup/pgdn", "page")}
	// moreKey opens the help page of the focused thing; it shows only where there is one.
	moreKey  = hint("?", "more")
	pageKeys = []key.Binding{hint("↑/↓", "scroll"), hint("esc/?", "close")}
)

func newHelpView() *helpView { return &helpView{vp: viewport.New()} }

func (v *helpView) Keys() []key.Binding {
	if v.page != nil {
		if v.page.copyText != "" {
			return []key.Binding{hint("c", "copy error"), hint("↑/↓", "scroll"), hint("esc", "close")}
		}
		return pageKeys
	}
	return helpKeys
}

func (v *helpView) Panes() []pane { return []pane{{"Keys", helpKeys}, {"Help page", pageKeys}} }

func (v *helpView) Capturing() bool { return false }

func (v *helpView) Title() string {
	if v.page != nil {
		return v.page.title
	}
	return "Keys"
}

// pageChrome is what a help page spends outside its text: a blank line, the
// title, a blank line, a blank line and the closing keys.
const pageChrome = 5

// openPage sizes the viewport and lays a help page into it.
func (v *helpView) openPage(ctx *viewContext, page helpPage) {
	v.page = &page
	v.layoutPage(ctx)
	v.vp.GotoTop()
}

// layoutPage lays the open page out again, as when the window is resized.
func (v *helpView) layoutPage(ctx *viewContext) {
	v.vp.SetWidth(max(min(ctx.width-4, 96), 20))
	v.vp.SetHeight(max(ctx.mainHeight()-pageChrome, 3))
	v.vp.SetContent(strings.Join(v.page.lines(ctx.theme, v.vp.Width()), "\n"))
}

// pageView is the open help page, in the place of the tab: its title, the
// part of the text in view and how to scroll and close it.
func (v *helpView) pageView(ctx *viewContext) string {
	t := ctx.theme
	closing := "↑/↓ scroll · esc or ? closes"
	if v.page.copyText != "" {
		closing = "c copies full error · ↑/↓ scroll · esc closes"
	}
	if !v.vp.AtBottom() {
		closing += " · more below ↓"
	}
	body := make([]string, 0, pageChrome+v.vp.Height())
	body = append(body, "", "  "+t.title().Render(v.page.title), "")
	for _, line := range strings.Split(v.vp.View(), "\n") {
		body = append(body, "  "+line)
	}
	return strings.Join(append(body, "", "  "+t.dim().Render(closing)), "\n")
}

// open sizes the viewport and lays the key reference into it, one group
// per pane: the global keys first, then each tab's panes.
func (v *helpView) open(ctx *viewContext, groups []pane) {
	v.page = nil
	v.vp.SetWidth(max(min(ctx.width-10, 92), 20))
	v.vp.SetHeight(max(ctx.height-8, 5))
	t := ctx.theme
	var lines []string
	if ctx.latest != "" {
		lines = append(lines, t.fg(t.info).Render(releaseNotice(ctx.latest)), "")
	}
	lines = append(lines, t.body().Render("Every change to an App or the Project goes through the Action menu:"),
		t.body().Render("a for the selected App, A for the Project."), "")
	for _, group := range groups {
		lines = append(lines, t.heading().Render(group.name))
		for _, b := range group.keys {
			lines = append(lines, "  "+t.title().Render(pad(b.Help().Key, 11))+" "+t.body().Render(b.Help().Desc))
		}
		lines = append(lines, "")
	}
	lines = append(lines,
		t.body().Render(link(t, koFiURL, "Buy us a coffee")),
		t.body().Render(link(t, sponsorsURL, "Sponsor on GitHub")), "",
		t.dim().Render("More: self-host --help (remove, restore, config, credentials…)"))
	v.vp.SetContent(strings.Join(lines, "\n"))
	v.vp.GotoTop()
}

func (v *helpView) Update(ctx *viewContext, msg tea.Msg) (view, tea.Cmd, nav) {
	if wheel, ok := msg.(tea.MouseWheelMsg); ok && v.page != nil {
		if wheel.Button == tea.MouseWheelUp {
			v.vp.ScrollUp(3)
		} else {
			v.vp.ScrollDown(3)
		}
		return v, nil, nav{}
	}
	press, ok := msg.(tea.KeyPressMsg)
	if !ok {
		return v, nil, nav{}
	}
	k := ctx.keys
	if v.page != nil && v.page.copyText != "" && press.String() == "c" {
		text := v.page.copyText
		return v, copyError(text), nav{}
	}
	closes := key.Matches(press, k.Help) || press.String() == "esc" || press.String() == "ctrl+c"
	switch {
	case v.page != nil && closes:
		return v, nil, nav{kind: navBack}
	case v.page != nil && !key.Matches(press, k.Up, k.Down, k.ScrollUp, k.ScrollDown):
		// Any other key is ignored, so it cannot act on the step behind the page.
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

func link(t theme, url, label string) string {
	return hyperlink(url, t.fg(t.info).Render(label))
}

// hyperlink wraps already styled, already truncated text in an OSC 8 link,
// which adds no visible width. An empty url leaves the text as it is.
func hyperlink(url, text string) string {
	if url == "" {
		return text
	}
	return ansi.SetHyperlink(url) + text + ansi.ResetHyperlink()
}
