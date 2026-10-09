package preboot

import (
	"math"

	"github.com/charmbracelet/x/ansi"
)

// starAt is the place of the star of image i: the sides of the screen,
// alternating, each a few rows below the one before, so it does not move as
// more images are known.
func (f *frame) starAt(i int) (x, y int) {
	reach := 8
	if f.lay.tier == medium {
		reach = 3
	}
	x = 2 + int(noise(31, i, 1)*float64(reach))
	if i%2 == 1 {
		x = f.w - 1 - x
	}
	y = 2 + (i/2*3+int(noise(30, i, 1)*2))%max(f.h-5, 1)
	return x, y
}

// imageStars lights one star per finished image, named with its image, and
// leaves a dim ring for each image still to come. A name that would run into
// the text is cut or left out.
func (f *frame) imageStars(cv *canvas) {
	if f.since >= 0 || f.lay.tier == small {
		return
	}
	t, b := f.t(), f.text
	for i, img := range f.pr.Images {
		x, y := f.starAt(i)
		if !img.Done {
			cv.put(x, y, '○', f.tint(f.pal.Muted, 0.55), 0.3)
			continue
		}
		c := f.pal.Sweep(float64(i)*0.17 + t*0.1)
		f.flare(cv, x, y, 0.5+0.5*math.Sin(t*3+float64(i)*1.3), c)
		cv.put(x, y, '✶', f.tint(f.pal.Glow(c, 0.7), 1), 1)

		label, lx := img.Label, x+3
		room := b.x0 - 3 - lx
		if x > f.w/2 {
			room = x - 3 - (b.x1 + 3)
		}
		if y >= b.y0 && y <= b.y1 {
			label = ansi.Truncate(label, room, "…")
		}
		if ansi.StringWidth(label) < min(4, ansi.StringWidth(img.Label)) {
			continue
		}
		if x > f.w/2 {
			lx = x - 3 - ansi.StringWidth(label)
		}
		cv.clear(lx-1, lx+ansi.StringWidth(label)+1, y)
		cv.text(lx, y, label, f.pal.Fade(c, 0.85), 0.6, false)
	}
}
