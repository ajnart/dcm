package preboot

import (
	"image/color"
	"math"
)

func (f *frame) tint(c color.RGBA, b float64) color.RGBA { return f.pal.Fade(c, 0.15+0.85*clamp01(b)) }

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
	cv.put(x, y, r, f.tint(c, b), b)
}

// flare draws a four-point sparkle that grows and fades over life in [0, 1].
func (f *frame) flare(cv *canvas, x, y int, life float64, c color.RGBA) {
	s := math.Sin(math.Pi * clamp01(life))
	if s < 0.15 {
		return
	}
	cv.put(x, y, '✦', f.tint(f.pal.Glow(c, 0.8), s), s)
	if s > 0.35 {
		cv.put(x-1, y, '─', f.tint(c, s*0.8), s*0.7)
		cv.put(x+1, y, '─', f.tint(c, s*0.8), s*0.7)
	}
	if s > 0.6 {
		cv.put(x, y-1, '│', f.tint(c, s*0.8), s*0.7)
		cv.put(x, y+1, '│', f.tint(c, s*0.8), s*0.7)
	}
	if s > 0.85 {
		cv.put(x-2, y, '·', f.tint(c, 0.6), 0.5)
		cv.put(x+2, y, '·', f.tint(c, 0.6), 0.5)
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
			cv.put(cx+dx, cy+dy, ch, c, lum)
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
				if cv.at(x, cy+dy).r == 0 && !f.thinned(x, cy+dy) {
					cv.put(x, cy+dy, '·', f.tint(c, a), a*0.8)
				}
			}
		}
	}
}

func dirGlyph(dx, dy float64) rune {
	a := math.Abs(math.Atan2(2*dy, dx))
	if a > math.Pi/2 {
		a = math.Pi - a
	}
	switch {
	case a < math.Pi/8:
		return '─'
	case a > 3*math.Pi/8:
		return '│'
	}
	if dx*dy > 0 {
		return '╲'
	}
	return '╱'
}

// brand is the ◆ with its halo and the lens streak that crosses it.
func (f *frame) brand(cv *canvas) {
	l, t := f.lay, f.t()
	pulse := 0.5 + 0.5*math.Sin(2*math.Pi*t/1.2)
	if f.warp() < 0.7 {
		f.halo(cv, l.cx, l.brandCY, l.brandR, 4)
	}
	span := f.w/2 - 2*l.brandR - 4
	for _, side := range []int{-1, 1} {
		for d := 0; d < span; d++ {
			x := l.cx + side*(2*l.brandR+3+d)
			a := math.Pow(1-float64(d)/float64(span), 2.2) * (0.35 + 0.5*pulse) * (1 + 1.5*f.warp())
			if a > 0.04 && cv.at(x, l.brandCY).r == 0 {
				cv.put(x, l.brandCY, '─', f.tint(f.pal.Sweep(float64(d)*0.012*float64(side)+t*0.15), a), a)
			}
		}
	}
	f.diamond(cv, l.cx, l.brandCY, l.brandR, t*0.3)
}

// thinned reports that the ray or ring at x, y is left out: near the text
// the tunnel is sparser, so the words stay easy to read.
func (f *frame) thinned(x, y int) bool {
	b := f.text
	if x < b.x0-6 || x > b.x1+6 || y < b.y0-1 || y > b.y1+1 {
		return false
	}
	share := 50
	if f.pal.Light || f.noColor {
		share = 75
	}
	return int(hash(x, y, 9)%100) < share
}

// tunnel draws the rings that rush past and the stars that fly outward from
// the centre along rays, their trails lengthening with the pull.
func (f *frame) tunnel(cv *canvas) {
	w, h, t, te, warp := f.w, f.h, f.t(), f.te(), f.warp()
	cx, cy := f.centre()
	rmax := math.Max(float64(w)/4, math.Max(float64(cy), float64(h-cy))) * 1.15
	phase := 0.5*t + 3*te*te*te
	rot := 0.1 * t
	dead := float64(f.lay.brandR + 3)
	compact := f.lay.tier == small

	rings := 7
	if compact {
		rings = 4
	}
	for k := 0; k < rings; k++ {
		z := math.Mod(float64(k)/float64(rings)+phase*0.5, 1)
		r := rmax * math.Pow(z, 2.3)
		if r < dead*0.8 {
			continue
		}
		a := math.Pow(z, 1.1) * 0.8 * (1 - warp*0.6)
		c := f.pal.Sweep(z*0.7 + float64(k)*0.14 + t*0.08)
		n := int(2*math.Pi*r*1.5) + 8
		for j := 0; j < n; j++ {
			th := 2*math.Pi*float64(j)/float64(n) + rot*2
			x := cx + int(math.Round(2*r*math.Cos(th)))
			y := cy + int(math.Round(r*math.Sin(th)))
			if cv.at(x, y).r == 0 && !f.thinned(x, y) {
				ch := '·'
				if a > 0.55 {
					ch = '∙'
				}
				cv.put(x, y, ch, f.tint(c, a), a*0.7)
			}
		}
	}

	n := w * h / 22
	if compact {
		n = w * h / 30
	}
	for i := 0; i < n; i++ {
		th := noise(1, i, 1)*2*math.Pi + rot
		z := math.Mod(noise(1, i, 2)+(0.6+noise(1, i, 3)*0.8)*phase, 1)
		d := 0.015 + 0.08*f.pr.Fraction + 0.55*warp
		z0 := math.Max(z-d, 0)
		rh := rmax * math.Pow(z, 2.2)
		rt := rmax * math.Pow(z0, 2.2)
		cosT, sinT := math.Cos(th), math.Sin(th)
		c := f.pal.Sweep(noise(1, i, 4) + t*0.12 + z*0.4)
		steps := int(math.Abs(rh-rt)*2) + 1
		ch := dirGlyph(2*cosT, sinT)
		for s := steps; s >= 0; s-- {
			u := float64(s) / float64(steps)
			r := rh - (rh-rt)*u
			if r < dead {
				continue
			}
			x := cx + int(math.Round(2*r*cosT))
			y := cy + int(math.Round(r*sinT))
			if f.thinned(x, y) {
				continue
			}
			b := math.Pow(z-(z-z0)*u, 1.1) * (1 - 0.7*u)
			switch {
			case s == 0 && steps <= 2:
				f.star(cv, x, y, 0.25+0.75*b, c)
			case s == 0:
				cv.put(x, y, '✦', f.tint(f.pal.Glow(c, 0.6), 0.3+0.7*b), 0.4+0.6*b)
			default:
				cv.put(x, y, ch, f.tint(c, 0.15+0.85*b), b)
			}
		}
	}
}
