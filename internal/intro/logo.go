// Package intro draws the Intro: the full-screen scene that opens
// Onboarding while Doctor checks the machine, its exit into Welcome, the
// Logo, and the reactions Welcome shows when the Experience choice moves.
//
// Rendering is pure: a frame is a function of the frame numbers, the size,
// the Doctor state, the palette and whether colour is off. The package keeps
// no clock and starts no goroutine; the caller counts frames at FPS.
package intro

import (
	"image/color"

	"github.com/ajnart/self-host/internal/scene"
)

// Level is how a container and its light stand: Unlit until its check has
// ticked into the Doctor line, then OK, Warn or Fail by the check.
type Level int

const (
	// Unlit is a grey container waiting for its Doctor check.
	Unlit Level = iota
	// OK is a lit container with a passing check.
	OK
	// Warn is a lit container with a warning check.
	Warn
	// Fail is a lit container with a failing check.
	Fail
)

// Scale is one of the Logo's three sizes.
type Scale int

const (
	// ScaleFull is the Intro's own size: 15 columns by 2 rows a container.
	ScaleFull Scale = iota
	// ScaleMedium is the Intro's size at Pre-boot's medium tier: 13 by 2.
	ScaleMedium
	// ScaleEmblem is Welcome's emblem: 9 by 1.
	ScaleEmblem
)

func (s Scale) width() int { return [3]int{15, 13, 9}[s] }

func (s Scale) pixelRows() int { return [3]int{4, 4, 2}[s] }

// Size is the Logo's width and height in cells, lights included.
func (s Scale) Size() (w, h int) { return s.width() + 2, 4 * s.pixelRows() / 2 }

const containers = 4

type box struct {
	i, x, py, w, hp, row, ru int
	ledX, ledY               int
	sk                       int
}

func rack(s Scale) []box {
	hp := s.pixelRows()
	out := make([]box, containers)
	for i := range out {
		row := containers - 1 - i
		py := row * hp
		out[i] = box{i: i, x: 0, py: py, w: s.width(), hp: hp, row: row, ru: i,
			ledX: s.width() + 1, ledY: (py+hp)/2 - 1, sk: [containers]int{0, 1, -1, 1}[i]}
	}
	return out
}

// DrawContainer draws one container as half-block pixels at x, py: a rail
// along the top and bottom, ribs on every other column with solid ends, the
// rails between ribs shaded as if lit from the top left. col is the colour
// of column c; the caller flushes the canvas.
func DrawContainer(cv *scene.Canvas, pal scene.Palette, x, py, w, hp int, col func(c int) color.RGBA, lum float64) {
	for c := range w {
		rib := c == 0 || c == w-1 || c&1 == 0
		fall := 1 - 0.14*float64(c)/float64(max(w-1, 1))
		base := col(c)
		top, low := pal.Glow(base, 0.14), pal.Fade(base, 0.74)
		for r := range hp {
			rail := r == 0 || (r == hp-1 && hp >= 3)
			if !rail && !rib {
				continue
			}
			k, l := low, lum*0.9
			switch {
			case rib:
				k, l = base, lum
			case r == 0:
				k = top
			}
			cv.Px(x+c, py+r, pal.Fade(k, fall), l)
		}
	}
}

func flat(c color.RGBA) func(int) color.RGBA { return func(int) color.RGBA { return c } }

// DrawLogo draws the Logo with every container lit at (ox, oy), its top-left
// cell. col is the colour of container i at column c and light the colour of
// its status light; the caller flushes the canvas.
func DrawLogo(cv *scene.Canvas, pal scene.Palette, s Scale, ox, oy int, col func(i, c int) color.RGBA, light func(i int) color.RGBA) {
	bs := rack(s)
	for _, b := range bs {
		DrawContainer(cv, pal, ox+b.x, 2*oy+b.py, b.w, b.hp, func(c int) color.RGBA { return col(b.i, c) }, 1)
	}
	cv.Flush()
	for _, b := range bs {
		cv.PutBold(ox+b.ledX, oy+b.ledY, '●', light(b.i), 1, true)
	}
}

func restTint(pal Palette, i int, l Level) (color.RGBA, float64) {
	own := pal.container(i)
	switch l {
	case Unlit:
		return pal.Fade(mix(own, pal.Muted, 0.6), 0.62), 0.55 + 0.45*0.62
	case OK:
		return own, 1
	}
	return mix(own, pal.level(l), 0.4), 1
}

func restLed(cv *scene.Canvas, pal Palette, x, y int, l Level, noColor bool, a float64) {
	if l == Unlit {
		cv.Put(x, y, '·', pal.Fade(pal.Muted, 0.45*a), 0.3*a)
		return
	}
	ch := '●'
	if l == Fail && noColor {
		ch = '×'
	}
	cv.PutBold(x, y, ch, pal.Fade(pal.level(l), a), a, a >= 0.8)
}

func drawRest(cv *scene.Canvas, pal Palette, s Scale, ox, oy int, levels [containers]Level, noColor bool, a float64) {
	bs := rack(s)
	for _, b := range bs {
		c, lum := restTint(pal, b.i, levels[b.i])
		DrawContainer(cv, pal.Palette, ox+b.x, 2*oy+b.py, b.w, b.hp, flat(pal.Fade(c, a)), lum*a)
	}
	cv.Flush()
	for _, b := range bs {
		restLed(cv, pal, ox+b.ledX, oy+b.ledY, levels[b.i], noColor, a)
	}
}

// RenderLogo draws the Logo at rest, one string per row, every row Size
// cells wide. levels is the state of each container, bottom (purple) first.
func RenderLogo(s Scale, levels [4]Level, pal Palette, noColor bool) []string {
	w, h := s.Size()
	cv := scene.New(w, h)
	drawRest(cv, pal, s, 0, 0, levels, noColor, 1)
	return cv.Lines(noColor)
}

// Emblem is Welcome's emblem: the emblem-scale Logo at rest, 11 columns by 4
// rows. The exit lands on exactly this and a reaction rests on it.
func Emblem(levels [4]Level, pal Palette, noColor bool) []string {
	return RenderLogo(ScaleEmblem, levels, pal, noColor)
}
