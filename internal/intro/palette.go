package intro

import (
	"image/color"

	"github.com/ajnart/self-host/internal/scene"
)

// UI is the TUI theme's colours, so the Doctor line, the cards and Welcome's
// pieces match the screens around the Intro.
type UI struct {
	Accent, AccentText, OK, Warn, Fail, Bright, Text, Muted, Faint color.RGBA
}

// Palette is the Intro's colours: the scenes' own set plus the TUI theme.
type Palette struct {
	scene.Palette
	UI UI
}

// Dark is the palette for a dark terminal.
func Dark() Palette {
	h := scene.Hex
	return Palette{Palette: scene.Dark(), UI: UI{
		Accent: h(0x7A57D3), AccentText: h(0xA88DF2), OK: h(0x00D787), Warn: h(0xFFAF00), Fail: h(0xFF5F5F),
		Bright: h(0xF5F5F5), Text: h(0xD0D0D0), Muted: h(0x8A8A8A), Faint: h(0x444444),
	}}
}

// Light is the palette for a light terminal.
func Light() Palette {
	h := scene.Hex
	return Palette{Palette: scene.Light(), UI: UI{
		Accent: h(0x5B3BB0), AccentText: h(0x5B3BB0), OK: h(0x1A7F37), Warn: h(0x9A6700), Fail: h(0xCF222E),
		Bright: h(0x111114), Text: h(0x2E2E34), Muted: h(0x6E6E76), Faint: h(0xBCBCC4),
	}}
}

func (p Palette) tint(c color.RGBA, b float64) color.RGBA { return p.Fade(c, 0.15+0.85*clamp01(b)) }

func (p Palette) container(i int) color.RGBA {
	return [4]color.RGBA{p.Purple, p.Pink, p.Cyan, p.Gold}[i&3]
}

func (p Palette) level(l Level) color.RGBA {
	switch l {
	case Fail:
		return p.UI.Fail
	case Warn:
		return p.UI.Warn
	}
	return p.UI.OK
}

var (
	clamp01 = scene.Clamp01
	smooth  = scene.Smooth
	noise   = scene.Noise
	mix     = scene.Lerp
)
