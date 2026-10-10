package preboot

import "math"

// sky is the parallax starfield: three layers of stars drifting left, each
// at its own speed, aurora ribbons above and below, shooting stars and
// sparkles. In the exit the stars stretch into streaks.
func (f *frame) sky(cv *canvas) {
	w, h, t, warp, te := f.w, f.h, f.t(), f.warp(), f.te()
	area := w * h
	layers := [3]struct {
		n            int
		speed, trail float64
		dim          float64
	}{
		{area / 40, 2.5, 7, 0.4},
		{area / 110, 6, 15, 0.65},
		{area / 260, 14, 30, 1},
	}
	if f.lay.tier == small {
		layers[0].n, layers[1].n, layers[2].n = area/30, area/90, area/200
	}
	for li, ly := range layers {
		for k := 0; k < ly.n; k++ {
			x0 := noise(li, k, 1) * float64(w)
			y := int(noise(li, k, 2) * float64(h))
			phase := noise(li, k, 3)
			rate := 0.5 + noise(li, k, 4)*1.6
			dist := ly.speed * (t + 25*te*te*te)
			x := int(math.Mod(math.Mod(x0-dist, float64(w))+float64(w), float64(w)))
			b := 0.5 + 0.5*math.Sin(2*math.Pi*(phase+rate*t))
			b = ly.dim * (0.25 + 0.75*b*b)
			b = b*(1-warp) + warp*(0.55+0.45*ly.dim)
			c := f.pal.Star
			switch li {
			case 1:
				c = f.pal.Sweep(noise(li, k, 5) + t*0.03)
			case 2:
				c = f.pal.Sweep(noise(li, k, 5) + t*0.09)
			}
			if trail := int(warp * ly.trail); trail > 0 {
				for j := 1; j <= trail; j++ {
					a := b * (1 - float64(j)/float64(trail+1))
					cv.put(x+j, y, '─', f.tint(c, a), a*0.7)
				}
				cv.put(x, y, '━', f.tint(f.pal.Glow(c, 0.5), 1), 1)
				continue
			}
			f.star(cv, x, y, b, c)
		}
	}
	if f.lay.tier != small && warp == 0 {
		f.shootingStars(cv)
		f.sparkles(cv)
	}
	f.ribbon(cv, 1.6, 1.2, 0)
	if f.lay.tier != small {
		f.ribbon(cv, float64(f.h)-2.4, 1.4, 1)
	}
}

// shootingStars sends two comets across the sky, each every few seconds.
func (f *frame) shootingStars(cv *canvas) {
	t := f.t()
	for s := 0; s < 2; s++ {
		period := 3.3 + float64(s)*0.9
		offset := float64(s) * 1.7
		cycle := int((t + offset) / period)
		u := math.Mod(t+offset, period) / 0.9
		if u >= 1 {
			continue
		}
		x0 := noise(20+s, cycle, 1)*float64(f.w)*0.7 + float64(f.w)*0.3
		y0 := noise(21+s, cycle, 2) * float64(f.h) * 0.5
		for j := 0; j < 9; j++ {
			uu := u - float64(j)*0.025
			if uu < 0 {
				break
			}
			x, y := int(x0-uu*38), int(y0+uu*11)
			a := 1 - float64(j)/9
			c := f.pal.Sweep(0.7 + float64(j)*0.03 + float64(s)*0.3)
			if j == 0 {
				cv.put(x, y, '✦', f.tint(f.pal.Glow(c, 0.8), 1), 1)
			} else {
				cv.put(x, y, '·', f.tint(c, a), a*0.7)
			}
		}
	}
}

// sparkles pops five sparkles at random places, each every second or two,
// and keeps them off the text.
func (f *frame) sparkles(cv *canvas) {
	t, b := f.t(), f.text
	for j := 0; j < 5; j++ {
		period := 1.1 + noise(9, j, 0)
		shift := noise(9, j, 1) * period
		cycle := int((t + shift) / period)
		life := math.Mod(t+shift, period) / 0.7
		if life >= 1 {
			continue
		}
		x := int(noise(10, j, cycle) * float64(f.w))
		y := int(noise(11, j, cycle) * float64(f.h))
		if x >= b.x0-3 && x <= b.x1+3 && y >= b.y0-1 && y <= b.y1+1 {
			continue
		}
		f.flare(cv, x, y, life, f.pal.Sweep(noise(12, j, cycle)))
	}
}

// ribbon draws an aurora ribbon in braille dots along row, waving by amp
// rows. It fades away as the stars stretch.
func (f *frame) ribbon(cv *canvas, row, amp float64, k int) {
	t := f.t()
	for sx := 0; sx < f.w*2; sx++ {
		x := float64(sx) / 2
		y := row + amp*math.Sin(x*0.07+t*1.1+float64(k)*2) + 0.5*amp*math.Sin(x*0.15-t*0.8)
		a := (0.42 + 0.25*math.Sin(x*0.05+t)) * (1 - f.warp())
		if a <= 0.02 {
			continue
		}
		c := f.pal.Sweep(x/float64(f.w)*0.8 + t*0.08 + float64(k)*0.5)
		cv.dot(sx, int(y*4), f.tint(c, a), a)
	}
}
