package preboot

import (
	"fmt"
	"image/color"
	"math"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

type seg struct {
	s    string
	c    color.RGBA
	bold bool
}

func segWidth(ss []seg) int {
	n := 0
	for _, s := range ss {
		n += ansi.StringWidth(s.s)
	}
	return n
}

type row struct {
	y, x int
	ss   []seg
	// held is how much of the row's colour is held back while it fades in.
	held float64
}

// block is the text the screen keeps readable: its rows and the box around
// them, which the sparkles stay clear of.
type block struct {
	rows           []row
	x0, x1, y0, y1 int
	// barX and barW are where the progress bar and its count start and how
	// wide they are together.
	barX, barW int
}

// factWidth keeps the bar from shifting when the count changes.
const factWidth = len("0 of 0 images")

func (f *frame) keySegs(prefix string) []seg {
	p := f.pal
	ss := []seg{{"c", p.Gold, true}, {" Ko-fi", p.Text, false}, {"   ·   ", p.Faint, false},
		{"s", p.Pink, true}, {" GitHub Sponsors", p.Text, false}, {"   ·   ", p.Faint, false},
		{"enter", p.Cyan, true}, {" skip", p.Text, false}}
	if prefix != "" {
		ss = append([]seg{{prefix, p.Muted, false}}, ss...)
	}
	return ss
}

func (f *frame) shortKeySegs() []seg {
	p := f.pal
	return []seg{{"c", p.Gold, true}, {" Ko-fi", p.Text, false}, {" · ", p.Faint, false},
		{"s", p.Pink, true}, {" Sponsors", p.Text, false}, {" · ", p.Faint, false},
		{"enter", p.Cyan, true}, {" skip", p.Text, false}}
}

// centred is the first of the variants that fits, centred in row y, else
// the last one cut with "…".
func (f *frame) centred(y int, variants ...[]seg) row {
	for _, ss := range variants {
		if w := segWidth(ss); w <= f.w-2 {
			return row{y: y, x: (f.w - w) / 2, ss: ss}
		}
	}
	return f.cut(y, variants[len(variants)-1])
}

func (f *frame) cut(y int, ss []seg) row {
	var out []seg
	budget := f.w - 3
	for _, s := range ss {
		if budget <= 0 {
			break
		}
		s.s = ansi.Truncate(s.s, budget, "…")
		budget -= ansi.StringWidth(s.s)
		out = append(out, s)
	}
	return row{y: y, x: (f.w - segWidth(out)) / 2, ss: out}
}

func (f *frame) layoutText() block {
	p, l, t := f.pal, f.lay, f.t()
	var b block

	title := "s e l f - h o s t"
	if l.tier == small {
		title = "◆  " + title
	}
	var ts []seg
	for i, r := range title {
		ts = append(ts, seg{string(r), p.Sweep(float64(i)*0.035 - t*0.3), true})
	}
	b.rows = append(b.rows, f.centred(l.titleY, ts))

	var lines [][]seg
	for _, line := range timeLines(f.pr.Remaining, f.n) {
		if line.lead == "" {
			lines = append(lines, []seg{{line.body, p.Muted, false}})
			continue
		}
		lines = append(lines, []seg{{line.lead, p.Text, false}, {line.body, p.Sweep(0.1 + t*0.04), true}})
	}
	left := f.centred(l.timeY, lines...)
	left.held = 1 - smooth(float64(f.n%rotateFrames)/6)
	b.rows = append(b.rows, left)
	b.rows = append(b.rows, f.centred(l.keysY, f.keySegs("Like self-host?   "), f.keySegs(""), f.shortKeySegs()))

	fact := f.fact()
	b.barW = l.barW + 2 + max(len(fact), factWidth)
	b.barX = (f.w - b.barW) / 2

	b.x0, b.x1, b.y0, b.y1 = b.barX, b.barX+b.barW, l.titleY, l.narrY
	for _, r := range b.rows {
		b.x0, b.x1 = min(b.x0, r.x), max(b.x1, r.x+segWidth(r.ss))
	}
	return b
}

func (f *frame) fact() string {
	switch {
	case f.pr.Total == 0:
		return "getting ready"
	case f.pr.Total == 1:
		return fmt.Sprintf("%d of %d image", f.pr.Done, f.pr.Total)
	}
	return fmt.Sprintf("%d of %d images", f.pr.Done, f.pr.Total)
}

func (f *frame) segs(cv *canvas, x, y int, ss []seg, fade float64) int {
	for _, s := range ss {
		lum := 0.55
		if s.bold {
			lum = 1
		}
		x = cv.text(x, y, s.s, f.pal.Fade(s.c, fade), lum, s.bold)
	}
	return x
}

func (f *frame) drawText(cv *canvas) {
	fade := f.fade()
	if fade <= 0 || f.noColor && fade < 0.5 {
		return
	}
	for _, r := range f.text.rows {
		if fade > 0.5 {
			cv.clear(r.x-2, r.x+segWidth(r.ss)+2, r.y)
		}
		f.segs(cv, r.x, r.y, r.ss, fade*(1-0.7*r.held))
	}
	f.progressBar(cv, fade)
}

func (f *frame) progressBar(cv *canvas, fade float64) {
	p, l, t := f.pal, f.lay, f.t()
	bw, x0 := l.barW, f.text.barX
	if fade > 0.5 {
		cv.clear(x0-2, x0+f.text.barW+2, l.barY)
		cv.clear(x0-2, x0+f.text.barW+2, l.barY-1)
	}
	eighths := int(clamp01(f.pr.Fraction) * float64(bw*8))
	whole, part := eighths/8, eighths%8
	shimmer := math.Mod(t*0.55, 1)*float64(whole+10) - 5
	for i := 0; i < bw; i++ {
		x := x0 + i
		switch {
		case i < whole || i == whole && part > 0:
			ch := '█'
			if i == whole {
				ch = []rune("▏▎▍▌▋▊▉")[part-1]
			}
			g := math.Exp(-math.Pow((float64(i)-shimmer)/2.5, 2))
			c := p.Glow(p.Sweep(float64(i)/float64(bw)*0.9-t*0.12), g*0.85)
			cv.put(x, l.barY, ch, p.Fade(c, fade), 0.55+0.45*g)
		default:
			cv.put(x, l.barY, '░', p.Fade(p.Faint, fade), 0.1)
		}
	}
	if f.pr.Fraction > 0 && f.pr.Fraction < 1 {
		b := 0.5 + 0.5*math.Sin(t*14)
		f.star(cv, x0+min(whole, bw-1), l.barY-1, 0.55+0.45*b, p.Sweep(t*0.4))
	}
	f.segs(cv, x0+bw+2, l.barY, []seg{{f.fact(), p.Muted, false}}, fade)
	f.narrative(cv, fade)
}

// narrative is the line under the bar, cut to the width of the text above.
func (f *frame) narrative(cv *canvas, fade float64) {
	if f.pr.Narrative == "" {
		return
	}
	p, t := f.pal, f.t()
	dots := strings.Repeat("·", int(t*4)%4)
	room := min(f.text.x1-f.text.x0, f.w-2) - 2 - len(dots)
	ss := []seg{{"◆ ", p.Sweep(t * 0.5), true}, {ansi.Truncate(f.pr.Narrative, room, "…"), p.Text, false}, {dots, p.Muted, false}}
	w := segWidth(ss) + 3 - len(dots)
	x := (f.w - w) / 2
	if fade > 0.5 {
		cv.clear(x-2, x+w+2, f.lay.narrY)
	}
	f.segs(cv, x, f.lay.narrY, ss, fade)
}
