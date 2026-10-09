package preboot

import (
	"math"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

type source int

const (
	fromScene source = iota
	fromUnder
	drawn
)

// reveal opens a diamond iris from the centre of the scene onto under:
// inside it is under, at its rim a band of shades and sparks, outside the
// scene. Rows are cut and joined with their styles kept.
func (f *frame) reveal(scene, under []string, opening float64) []string {
	under = f.fit(under)
	cx, cy := f.centre()
	far := 0.0
	for _, c := range [][2]int{{0, 0}, {f.w, 0}, {0, f.h}, {f.w, f.h}} {
		far = math.Max(far, math.Abs(float64(c[0]-cx))/2+math.Abs(float64(c[1]-cy)))
	}
	reach := smooth(opening) * (far + 3)
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
			d := (reach - (math.Abs(float64(x-cx))/2 + math.Abs(float64(y-cy)))) * 2
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
