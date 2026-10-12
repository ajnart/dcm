package tui

import (
	"image/color"
	"math"
)

const openingFrames = 3

func (m Model) openingTheme() theme {
	t := m.theme
	if m.opening <= 0 {
		return t
	}
	progress := 1 - float64(m.opening)/openingFrames
	amount := 0.55 + 0.45*(1-math.Pow(1-progress, 3))
	blend := func(from, to color.Color) color.Color {
		a := color.RGBAModel.Convert(from).(color.RGBA)
		b := color.RGBAModel.Convert(to).(color.RGBA)
		channel := func(x, y uint8) uint8 {
			return uint8(math.Round(float64(x) + (float64(y)-float64(x))*amount))
		}
		return color.RGBA{R: channel(a.R, b.R), G: channel(a.G, b.G), B: channel(a.B, b.B), A: 255}
	}
	t.accent = blend(t.faint, t.accent)
	t.accentText = blend(t.muted, t.accentText)
	t.bright = blend(t.text, t.bright)
	return t
}
