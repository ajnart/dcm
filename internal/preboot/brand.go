package preboot

import (
	"image/color"
	"math"

	"github.com/ajnart/self-host/internal/intro"
)

func (f *frame) tint(c color.RGBA, b float64) color.RGBA { return f.pal.Fade(c, 0.15+0.85*clamp01(b)) }

// star draws one star of brightness b; brighter ones are bigger glyphs, so
// the twinkle shows without colour too.
func (f *frame) star(cv *canvas, x, y int, b float64, c color.RGBA) {
	r := '·'
	switch {
	case b > 0.9:
		r = '✶'
	case b > 0.72:
		r = '✦'
	case b > 0.5:
		r = '+'
	}
	cv.Put(x, y, r, f.tint(c, b), b)
}

// flare draws a four-point sparkle that grows and fades over life in [0, 1].
func (f *frame) flare(cv *canvas, x, y int, life float64, c color.RGBA) {
	s := math.Sin(math.Pi * clamp01(life))
	if s < 0.15 {
		return
	}
	cv.Put(x, y, '✦', f.tint(f.pal.Glow(c, 0.8), s), s)
	if s > 0.35 {
		cv.Put(x-1, y, '─', f.tint(c, s*0.8), s*0.7)
		cv.Put(x+1, y, '─', f.tint(c, s*0.8), s*0.7)
	}
	if s > 0.6 {
		cv.Put(x, y-1, '│', f.tint(c, s*0.8), s*0.7)
		cv.Put(x, y+1, '│', f.tint(c, s*0.8), s*0.7)
	}
	if s > 0.85 {
		cv.Put(x-2, y, '·', f.tint(c, 0.6), 0.5)
		cv.Put(x+2, y, '·', f.tint(c, 0.6), 0.5)
	}
}

func (f *frame) brand(cv *canvas) {
	l, t := f.lay, f.t()
	scale := intro.ScaleMedium
	if l.tier == full {
		scale = intro.ScaleFull
	}
	w, h := scale.Size()
	x, y := l.cx-w/2, max(l.titleY-h-1, 0)
	for row := y; row < y+h; row++ {
		cv.Clear(x, x+w, row)
	}
	glint := math.Mod(t*7, 40) - 12
	pulse := 0.5 + 0.5*math.Sin(2*math.Pi*t/1.5)
	col := func(i, c int) color.RGBA {
		dx := float64(c - (w-2)/2)
		dy := float64(3-i)*2 - 3
		band := math.Exp(-math.Pow((dx*0.5-dy*0.9-glint+12)/3, 2))
		return f.pal.Glow(f.pal.Sweep(t*0.18+float64(i)*0.25+dx*0.02), band*0.9+pulse*0.25)
	}
	intro.DrawLogo(cv, f.pal, scale, x, y, col, func(i int) color.RGBA {
		return f.pal.Glow(col(i, w-3), 0.3)
	})
	for row := range h {
		for c := 0; c < w-2; c++ {
			ce := cv.At(x+c, y+row)
			dx, dy := float64(c-(w-2)/2), float64(row)-3.5
			band := math.Exp(-math.Pow((dx*0.5-dy*0.9-glint+12)/3, 2))
			ce.Lum = 0.45 + 0.3*pulse + 0.6*band
			if f.noColor && ce.R == '█' && ce.Lum < 0.7 {
				ce.R = '▓'
				if ce.Lum < 0.5 {
					ce.R = '▒'
				}
			}
			cv.Put(x+c, y+row, ce.R, ce.FG, ce.Lum)
		}
	}
}
