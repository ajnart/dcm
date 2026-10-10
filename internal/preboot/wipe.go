package preboot

import (
	"strings"

	"github.com/charmbracelet/x/ansi"
)

type source int

const (
	fromScene source = iota
	fromUnder
	drawn
)

// reveal wipes under in along a slanted edge that sweeps from the right
// edge of the screen to the left: right of the edge is under, at the edge a
// band of shades and sparks, left of it the scene. Rows are cut and joined
// with their styles kept.
func (f *frame) reveal(scene, under []string, opening float64) []string {
	under = f.fit(under)
	span := float64(f.w + 2*f.h + 12)
	front := (1-smooth(opening))*span - 2*float64(f.h)
	shades := []rune("░▒▓█")
	out := make([]string, f.h)
	for y := range out {
		var sb strings.Builder
		from, src := 0, fromScene
		flush := func(end int) {
			switch {
			case src == drawn || end <= from:
			case src == fromUnder:
				sb.WriteString(ansi.Cut(under[y], from, end))
			default:
				sb.WriteString(ansi.Cut(scene[y], from, end))
			}
		}
		for x := 0; x < f.w; x++ {
			d := float64(x) - (front + 2*float64(y) - 6)
			next, glyph := fromScene, ""
			switch {
			case d >= 5:
				next = fromUnder
			case d >= 0 && opening < 1:
				k := min(int(d*0.8), 3)
				c := f.pal.Sweep(float64(x+y)*0.012 + f.t()*0.8)
				shade := cell{r: shades[3-k], fg: f.pal.Fade(c, 0.35+0.65*float64(4-k)/4), lum: float64(4-k) / 4}
				next, glyph = drawn, shade.look(f.noColor).apply(string(shade.r), f.noColor)
			case d >= -3 && opening < 1 && hash(x, y, 7)%5 == 0:
				spark := cell{r: '✦', fg: f.pal.Glow(f.pal.Sweep(noise(x, y, 3)), 0.6), lum: 1}
				next, glyph = drawn, spark.look(f.noColor).apply(string(spark.r), f.noColor)
			}
			if next != src || next == drawn {
				flush(x)
				from, src = x, next
			}
			if next == drawn {
				sb.WriteString(glyph)
				from = x + 1
			}
		}
		flush(f.w)
		out[y] = sb.String()
	}
	return out
}

// fit gives under exactly f.h rows of f.w cells.
func (f *frame) fit(under []string) []string {
	out := make([]string, f.h)
	for y := range out {
		if y < len(under) {
			out[y] = under[y]
		}
		if w := ansi.StringWidth(out[y]); w < f.w {
			out[y] += strings.Repeat(" ", f.w-w)
		}
	}
	return out
}
