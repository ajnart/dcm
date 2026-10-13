package scene

import (
	"image/color"
	"math"
)

// Palette is the full-screen scenes' own set of colours: they are the only
// screens that may use several.
type Palette struct {
	Light                    bool
	Purple, Pink, Cyan, Gold color.RGBA
	Text, Muted, Faint, Star color.RGBA
	Bg                       color.RGBA
}

// Hex is the colour 0xRRGGBB.
func Hex(v uint32) color.RGBA {
	return color.RGBA{R: uint8(v >> 16), G: uint8(v >> 8), B: uint8(v), A: 255}
}

// Dark is the palette for a dark terminal.
func Dark() Palette {
	return Palette{
		Purple: Hex(0x7A57D3), Pink: Hex(0xFF5FA8), Cyan: Hex(0x3DDCFF), Gold: Hex(0xFFC857),
		Text: Hex(0xEDEBF5), Muted: Hex(0xA09DB5), Faint: Hex(0x4A4663), Star: Hex(0xC9C6E6),
		Bg: Hex(0x000000),
	}
}

// Light is the palette for a light terminal.
func Light() Palette {
	return Palette{
		Light:  true,
		Purple: Hex(0x5B3BB0), Pink: Hex(0xD6246E), Cyan: Hex(0x0A87AD), Gold: Hex(0xB57400),
		Text: Hex(0x1D1A2B), Muted: Hex(0x5A5670), Faint: Hex(0xCBC7DD), Star: Hex(0x8C88A8),
		Bg: Hex(0xFFFFFF),
	}
}

// Lerp blends a toward b by t.
func Lerp(a, b color.RGBA, t float64) color.RGBA {
	t = Clamp01(t)
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
	return Lerp(stops[i%4], stops[(i+1)%4], f)
}

// Fade blends c toward the background; a = 1 keeps it whole.
func (p Palette) Fade(c color.RGBA, a float64) color.RGBA { return Lerp(p.Bg, c, a) }

// Glow pushes c toward the extreme that reads as brighter.
func (p Palette) Glow(c color.RGBA, a float64) color.RGBA {
	if p.Light {
		return Lerp(c, color.RGBA{A: 255}, a*0.35)
	}
	return Lerp(c, color.RGBA{R: 255, G: 255, B: 255, A: 255}, a*0.6)
}

// Smooth eases x, clamped to [0, 1], in and out.
func Smooth(x float64) float64 {
	x = Clamp01(x)
	return x * x * (3 - 2*x)
}

// Clamp01 limits x to [0, 1].
func Clamp01(x float64) float64 { return math.Min(math.Max(x, 0), 1) }

// Abs is the absolute value of x.
func Abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// Hash mixes a, b and c into a repeatable number.
func Hash(a, b, c int) uint32 {
	x := uint32(a)*0x9E3779B1 ^ uint32(b)*0x85EBCA77 ^ uint32(c)*0xC2B2AE3D
	x ^= x >> 15
	x *= 0x2C1B3C6D
	x ^= x >> 12
	x *= 0x297A2D39
	x ^= x >> 15
	return x
}

// Noise is a repeatable pseudo-random number in [0, 1) for a, b and c.
func Noise(a, b, c int) float64 { return float64(Hash(a, b, c)&0xFFFFFF) / float64(0x1000000) }
