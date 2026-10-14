package tui

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/host"
)

// theme is the dashboard's visual vocabulary. One purple accent marks focus,
// selection and progress; green, amber and red only ever mean a state; and a
// grey ramp from bright to faint carries the hierarchy, together with weight.
type theme struct {
	accent, ok, warn, fail, info, muted, faint, text, bright, ink, selected color.Color
	// accentText is the accent as a text colour: lighter on dark terminals,
	// where the accent itself is too dim to read.
	accentText color.Color
	// surface is the near-black ground of status chips.
	surface color.Color
	// dark is whether the terminal's background is dark.
	dark bool
}

// Colors is the theme's colours as hex, one per role, so the site can
// share them.
type Colors struct {
	Accent, AccentText, OK, Warn, Fail, Info, Bright, Text, Muted, Faint, Ink, Selected, Surface string
}

var (
	LightColors = Colors{
		Accent: "#5B3BB0", AccentText: "#5B3BB0", OK: "#1A7F37", Warn: "#9A6700", Fail: "#CF222E", Info: "#0969DA",
		Bright: "#111114", Text: "#2E2E34", Muted: "#6E6E76", Faint: "#BCBCC4", Ink: "#FFFFFF", Selected: "#E6DDF7", Surface: "#ECEAF2",
	}
	DarkColors = Colors{
		Accent: "#7A57D3", AccentText: "#A88DF2", OK: "#00D787", Warn: "#FFAF00", Fail: "#FF5F5F", Info: "#5FAFFF",
		Bright: "#F5F5F5", Text: "#D0D0D0", Muted: "#8A8A8A", Faint: "#444444", Ink: "#F5F5F5", Selected: "#2B2140", Surface: "#26262C",
	}
)

func newTheme(dark bool) theme {
	ld := lipgloss.LightDark(dark)
	pick := func(light, dark string) color.Color { return ld(lipgloss.Color(light), lipgloss.Color(dark)) }
	l, d := LightColors, DarkColors
	return theme{
		dark:       dark,
		accent:     pick(l.Accent, d.Accent),
		accentText: pick(l.AccentText, d.AccentText),
		ok:         pick(l.OK, d.OK),
		warn:       pick(l.Warn, d.Warn),
		fail:       pick(l.Fail, d.Fail),
		info:       pick(l.Info, d.Info),
		bright:     pick(l.Bright, d.Bright),
		text:       pick(l.Text, d.Text),
		muted:      pick(l.Muted, d.Muted),
		faint:      pick(l.Faint, d.Faint),
		ink:        pick(l.Ink, d.Ink),
		selected:   pick(l.Selected, d.Selected),
		surface:    pick(l.Surface, d.Surface),
	}
}

func (t theme) fg(c color.Color) lipgloss.Style { return lipgloss.NewStyle().Foreground(c) }

// status is how a Status level (ok, attention, broken) looks: a glyph, so it
// reads without colour, and its colour. Anything else reads as broken.
func (t theme) status(level string) (string, color.Color) {
	switch level {
	case "ok":
		return "●", t.ok
	case "attention":
		return "◐", t.warn
	default:
		return "✗", t.fail
	}
}

// dot is the coloured Status marker.
func (t theme) dot(level string) string {
	glyph, c := t.status(level)
	return t.fg(c).Render(glyph)
}

// checkLevel maps a host check's level onto the Status levels.
func checkLevel(l host.Level) string {
	switch l {
	case host.OK:
		return "ok"
	case host.Warn:
		return "attention"
	default:
		return "broken"
	}
}

// chip is a pill on a near-black surface, coloured by what it reports.
func (t theme) chip(label string, c color.Color) string {
	return lipgloss.NewStyle().Bold(true).Foreground(c).Background(t.surface).Padding(0, 1).Render(label)
}

// brand is the top-left mark, the width of a chip.
func (t theme) brand(g activity.Glyphs) string {
	return " " + t.title().Render(g.Brand()) + " " + t.active().Render("self-host") + " "
}

// button is a key the person can press, filled with the accent.
func (t theme) button(label string) string {
	return lipgloss.NewStyle().Bold(true).Foreground(t.ink).Background(t.accent).Padding(0, 1).Render(label)
}

func (t theme) title() lipgloss.Style   { return lipgloss.NewStyle().Bold(true).Foreground(t.accentText) }
func (t theme) heading() lipgloss.Style { return t.active() }
func (t theme) dim() lipgloss.Style     { return t.fg(t.muted) }
func (t theme) body() lipgloss.Style    { return t.fg(t.text) }

// active, inactive and disabled are the weight and brightness hierarchy:
// what is active or focused is bold and near-white, the rest normal grey,
// and what cannot be used is faint.
func (t theme) active() lipgloss.Style   { return lipgloss.NewStyle().Bold(true).Foreground(t.bright) }
func (t theme) inactive() lipgloss.Style { return t.fg(t.muted) }
func (t theme) disabled() lipgloss.Style { return t.fg(t.faint) }

// current marks the active top-bar surface or detail tab.
func (t theme) current() lipgloss.Style {
	return t.active().Underline(true).UnderlineColor(t.accent)
}

// selection is the highlighted row on its purple-tinted surface.
func (t theme) selection() lipgloss.Style { return t.active().Background(t.selected) }

func (t theme) cursor() string { return t.title().Render("> ") }

// stepMark is the mark of a Setup step's state: a glyph, so it reads without
// colour, and the state's colour.
func (t theme) stepMark(state activity.State) string {
	switch state {
	case activity.Done:
		return t.fg(t.ok).Render("✓")
	case activity.Skipped:
		return t.dim().Render("↷")
	case activity.Manual:
		return t.fg(t.warn).Render("! manual")
	case activity.Failed:
		return t.fg(t.fail).Render("✗")
	case activity.Running:
		return t.fg(t.accentText).Render("…")
	}
	return t.dim().Render("○")
}

func (t theme) panel(focused bool) lipgloss.Style {
	border := t.faint
	if focused {
		border = t.accent
	}
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(border).Padding(0, 1)
}

// box draws a rounded panel of exactly width×height cells with title and a
// dim note set into its top border. The focused box has an accent border and
// a bold, bright title; the others a faint border and a grey title.
func (t theme) box(title, note, body string, width, height int, focused bool) string {
	border := t.fg(t.faint)
	heading := t.inactive()
	if focused {
		border = t.fg(t.accent)
		heading = t.active()
	}
	label := " " + heading.Render(title)
	if note != "" {
		label += t.dim().Render(" " + note)
	}
	label += " "
	fill := max(width-3-lipgloss.Width(label), 0)
	lines := []string{border.Render("╭─") + label + border.Render(strings.Repeat("─", fill)+"╮")}
	for _, line := range strings.Split(fit(body, max(width-4, 0), max(height-2, 0)), "\n") {
		lines = append(lines, border.Render("│")+" "+line+" "+border.Render("│"))
	}
	lines = append(lines, border.Render("╰"+strings.Repeat("─", max(width-2, 0))+"╯"))
	return strings.Join(lines, "\n")
}

func truncate(s string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(s, width, "…")
}

// pad truncates or right-pads s to exactly width cells.
func pad(s string, width int) string {
	s = truncate(s, width)
	if gap := width - lipgloss.Width(s); gap > 0 {
		s += strings.Repeat(" ", gap)
	}
	return s
}
