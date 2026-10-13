package preboot

import (
	"image/color"
	"math"
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

// diamond draws the solid ◆ with a colour sweep and a moving glint.
func (f *frame) diamond(cv *canvas, cx, cy, r int, hue float64) {
	t := f.t()
	pulse := 0.5 + 0.5*math.Sin(2*math.Pi*t/1.5)
	glint := math.Mod(t*7, 40) - 12
	for dy := -r; dy <= r; dy++ {
		hw := 2 * (r - abs(dy))
		for dx := -hw; dx <= hw; dx++ {
			ch := '█'
			switch {
			case dy == -r:
				ch = '▲'
			case dy == r:
				ch = '▼'
			case dx == -hw && dy < 0:
				ch = '◢'
			case dx == hw && dy < 0:
				ch = '◣'
			case dx == -hw && dy > 0:
				ch = '◥'
			case dx == hw && dy > 0:
				ch = '◤'
			case dx == -hw:
				ch = '◀'
			case dx == hw:
				ch = '▶'
			}
			band := math.Exp(-math.Pow((float64(dx)*0.5-float64(dy)*0.9-glint+12)/3, 2))
			c := f.pal.Glow(f.pal.Sweep(hue+float64(dx)*0.02+float64(dy)*0.05), band*0.9+pulse*0.25)
			lum := 0.45 + 0.3*pulse + 0.6*band
			if f.noColor && ch == '█' {
				switch {
				case lum >= 0.7:
				case lum >= 0.5:
					ch = '▓'
				default:
					ch = '▒'
				}
			}
			cv.Put(cx+dx, cy+dy, ch, c, lum)
		}
	}
}

// halo draws diamond rings that expand from the brand and fade.
func (f *frame) halo(cv *canvas, cx, cy, r, rings int) {
	t := f.t()
	maxD := float64(r) + 9
	for k := 0; k < rings; k++ {
		u := math.Mod(t/1.9+float64(k)/float64(rings), 1)
		d := float64(r) + 1.5 + u*(maxD-float64(r))
		a := (1 - u) * (1 - u)
		c := f.pal.Sweep(u*0.7 + float64(k)*0.3 + t*0.1)
		for dy := -int(d) - 1; dy <= int(d)+1; dy++ {
			dx := (d - math.Abs(float64(dy))) * 2
			if dx < 0 {
				continue
			}
			for _, sx := range []float64{-dx, dx} {
				x := cx + int(math.Round(sx))
				if cv.At(x, cy+dy).R == 0 {
					cv.Put(x, cy+dy, '·', f.tint(c, a), a*0.8)
				}
			}
		}
	}
}

// brand is the ◆ with its ripple rings and a sparkle at each tip. The rings
// give way to the streaks once the exit is well under way.
func (f *frame) brand(cv *canvas) {
	l, t := f.lay, f.t()
	if f.warp() < 0.6 {
		f.halo(cv, l.cx, l.brandCY, l.brandR, 3)
	}
	tips := [4][2]int{{-2*l.brandR - 3, 0}, {2*l.brandR + 3, 0}, {0, -l.brandR - 1}, {0, l.brandR + 1}}
	for i, tip := range tips {
		life := math.Mod(t/1.5+float64(i)*0.25, 1)
		f.flare(cv, l.cx+tip[0], l.brandCY+tip[1], life, f.pal.Sweep(t*0.2+float64(i)*0.25))
	}
	f.diamond(cv, l.cx, l.brandCY, l.brandR, t*0.18)
}
