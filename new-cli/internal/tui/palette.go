package tui

import "github.com/ajnart/self-host/internal/activity"

// Palette is the theme's colours for the Activity renderer, so the CLI draws
// with the same values as the TUI.
func Palette(dark bool) activity.Palette {
	return newTheme(dark).palette()
}

func (t theme) palette() activity.Palette {
	return activity.Palette{Accent: t.accent, AccentText: t.accentText, OK: t.ok, Warn: t.warn, Fail: t.fail,
		Bright: t.bright, Text: t.text, Muted: t.muted, Faint: t.faint}
}
