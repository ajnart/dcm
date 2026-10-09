package preboot

import (
	"image/color"
	"math"
)

// Palette is the pre-boot screen's own set of colours: it is the one screen
// that may use several.
type Palette struct {
	Light                    bool
	Purple, Pink, Cyan, Gold color.RGBA
	Text, Muted, Faint       color.RGBA
	Cup, Coffee, Bg          color.RGBA
}

func hex(v uint32) color.RGBA {
	return color.RGBA{R: uint8(v >> 16), G: uint8(v >> 8), B: uint8(v), A: 255}
}

// Dark is the palette for a dark terminal.
func Dark() Palette {
	return Palette{
		Purple: hex(0x7A57D3), Pink: hex(0xFF5FA8), Cyan: hex(0x3DDCFF), Gold: hex(0xFFC857),
		Text: hex(0xEDEBF5), Muted: hex(0xA09DB5), Faint: hex(0x4A4663),
		Cup: hex(0xE8E6F2), Coffee: hex(0xC98A4B), Bg: hex(0x000000),
	}
}

// Light is the palette for a light terminal.
func Light() Palette {
	return Palette{
		Light:  true,
		Purple: hex(0x5B3BB0), Pink: hex(0xD6246E), Cyan: hex(0x0A87AD), Gold: hex(0xB57400),
		Text: hex(0x1D1A2B), Muted: hex(0x5A5670), Faint: hex(0xCBC7DD),
		Cup: hex(0x3A3650), Coffee: hex(0x8A5524), Bg: hex(0xFFFFFF),
	}
}

func lerp(a, b color.RGBA, t float64) color.RGBA {
	t = clamp01(t)
	l := func(x, y uint8) uint8 { return uint8(math.Round(float64(x) + (float64(y)-float64(x))*t)) }
	return color.RGBA{R: l(a.R, b.R), G: l(a.G, b.G), B: l(a.B, b.B), A: 255}
}

// Sweep is the purple, pink, cyan, gold cycle at x, one cycle per 1.0.
func (p Palette) Sweep(x float64) color.RGBA {
	stops := [4]color.RGBA{p.Purple, p.Pink, p.Cyan, p.Gold}
	x -= math.Floor(x)
	x *= 4
	i := int(x)
	f := x - float64(i)
	f = f * f * (3 - 2*f)
	return lerp(stops[i%4], stops[(i+1)%4], f)
}

// Fade blends c toward the background; a = 1 keeps it whole.
func (p Palette) Fade(c color.RGBA, a float64) color.RGBA { return lerp(p.Bg, c, a) }

// Glow pushes c toward the extreme that reads as brighter.
func (p Palette) Glow(c color.RGBA, a float64) color.RGBA {
	if p.Light {
		return lerp(c, color.RGBA{A: 255}, a*0.35)
	}
	return lerp(c, color.RGBA{R: 255, G: 255, B: 255, A: 255}, a*0.6)
}

func smooth(x float64) float64 {
	x = clamp01(x)
	return x * x * (3 - 2*x)
}

func clamp01(x float64) float64 { return math.Min(math.Max(x, 0), 1) }

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func hash(a, b, c int) uint32 {
	x := uint32(a)*0x9E3779B1 ^ uint32(b)*0x85EBCA77 ^ uint32(c)*0xC2B2AE3D
	x ^= x >> 15
	x *= 0x2C1B3C6D
	x ^= x >> 12
	x *= 0x297A2D39
	x ^= x >> 15
	return x
}

// noise is a repeatable pseudo-random number in [0, 1) for a, b and c.
func noise(a, b, c int) float64 { return float64(hash(a, b, c)&0xFFFFFF) / float64(0x1000000) }
