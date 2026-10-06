package tui

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// theme is the dashboard's visual vocabulary. Colour carries meaning — green
// works, amber needs attention, red is broken — so the palette stays small.
type theme struct {
	accent, ok, warn, fail, info, muted, faint, text, bright, ink, selected color.Color
}

func newTheme(dark bool) theme {
	ld := lipgloss.LightDark(dark)
	return theme{
		accent:   ld(lipgloss.Color("#6E40C9"), lipgloss.Color("212")),
		ok:       ld(lipgloss.Color("#1A7F37"), lipgloss.Color("42")),
		warn:     ld(lipgloss.Color("#9A6700"), lipgloss.Color("214")),
		fail:     ld(lipgloss.Color("#CF222E"), lipgloss.Color("203")),
		info:     ld(lipgloss.Color("#0969DA"), lipgloss.Color("81")),
		muted:    ld(lipgloss.Color("243"), lipgloss.Color("245")),
		faint:    ld(lipgloss.Color("250"), lipgloss.Color("238")),
		text:     ld(lipgloss.Color("236"), lipgloss.Color("252")),
		bright:   ld(lipgloss.Color("16"), lipgloss.Color("230")),
		ink:      ld(lipgloss.Color("255"), lipgloss.Color("235")),
		selected: ld(lipgloss.Color("189"), lipgloss.Color("57")),
	}
}

func (t theme) fg(c color.Color) lipgloss.Style { return lipgloss.NewStyle().Foreground(c) }

func (t theme) levelColor(level string) color.Color {
	switch level {
	case "ok":
		return t.ok
	case "warn":
		return t.warn
	default:
		return t.fail
	}
}

// dot is the coloured health marker.
func (t theme) dot(level string) string { return t.fg(t.levelColor(level)).Render("●") }

// chip is a filled pill for the few states that must be seen at a glance.
func (t theme) chip(label string, bg color.Color) string {
	return lipgloss.NewStyle().Bold(true).Foreground(t.ink).Background(bg).Padding(0, 1).Render(label)
}

func (t theme) title() lipgloss.Style   { return lipgloss.NewStyle().Bold(true).Foreground(t.accent) }
func (t theme) heading() lipgloss.Style { return lipgloss.NewStyle().Bold(true).Foreground(t.bright) }
func (t theme) dim() lipgloss.Style     { return t.fg(t.muted) }
func (t theme) body() lipgloss.Style    { return t.fg(t.text) }

func (t theme) panel(focused bool) lipgloss.Style {
	border := t.faint
	if focused {
		border = t.accent
	}
	return lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(border).Padding(0, 1)
}

// rule draws a labelled separator.
func (t theme) rule(label string, width int) string {
	prefix := "── " + label + " "
	fill := width - lipgloss.Width(prefix)
	if fill < 0 {
		return t.dim().Render(truncate(prefix, width))
	}
	return t.dim().Render(prefix + strings.Repeat("─", fill))
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
