package intro

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/scene"
	"github.com/charmbracelet/x/ansi"
)

func charge(p float64) float64 { return 0.6 * math.Sin(math.Pi*clamp01(p/0.14)) }

func (c *sctx) levels() [containers]Level {
	var out [containers]Level
	for i, k := range c.checks {
		if k.age >= 0 {
			out[i] = k.level
		}
	}
	return out
}

func (c *sctx) wordOut(cv *scene.Canvas, L lay, p float64) {
	pal := c.pal
	secs := p * float64(ExitFrames) / FPS
	for _, ce := range L.wm.cells {
		if hidden(L, ce) >= 1 {
			continue
		}
		flip := 0.02 + 0.16*ce.nx + 0.04*ce.n
		gone := flip + 0.12 + 0.2*noise(ce.dc, ce.dr, 51)
		if p >= gone {
			continue
		}
		x, y := L.x0+ce.dc, L.r0+ce.dr
		col := pal.Sweep(ce.hue)
		if p < flip {
			put(cv, x, y, ce.glyph, col, 0.9)
			continue
		}
		u := math.Floor((p-flip)/(gone-flip)*4) / 4
		kk := fl(secs*16 + ce.n*4)
		cc, cl := cipherColour(pal, ce.dc, ce.dr, kk, 0.8*(1-u))
		ch := cipherGlyph(ce.dc+131*kk, ce.dr, 13)
		if u >= 0.75 {
			ch = '·'
		}
		put(cv, x, y, ch, mix(col, cc, 0.35+0.65*u), cl+0.15*(1-u))
	}
}

func (c *sctx) drawTitle(cv *scene.Canvas, p float64) {
	if c.tier == tierSmall {
		return
	}
	pal := c.pal
	tg := c.target
	acc := pal.UI.AccentText
	secs := p * float64(ExitFrames) / FPS
	for j, ch := range []rune(tg.Title) {
		if ch == ' ' {
			continue
		}
		ta := 0.1 + 0.017*float64(j)
		tl := 0.27 + 0.022*float64(j) + 0.04*noise(j, 2, 63)
		if p < ta {
			continue
		}
		if p < tl {
			kk := fl(secs*18 + float64(j))
			cc, cl := cipherColour(pal, j, 91, kk, 0.45+0.4*smooth((p-ta)/(tl-ta)))
			put(cv, tg.TitleAt.X+j, tg.TitleAt.Y, cipherGlyph(j+37*kk, 3, 17), mix(cc, acc, 0.3), cl)
			continue
		}
		f := 1 - outCubic((p-tl)/0.14)
		col := acc
		if f > 0 {
			col = pal.Glow(acc, 0.8*f)
		}
		putB(cv, tg.TitleAt.X+j, tg.TitleAt.Y, ch, col, 1, true)
	}
}

func (c *sctx) exitToEmblem(cv *scene.Canvas, L lay, p float64) {
	pal := c.pal
	box := *c.target.Emblem
	_, eh := ScaleEmblem.Size()
	if p >= swap {
		drawRest(cv, pal, ScaleEmblem, box.X, box.Y+box.H-eh, c.levels(), c.noColor, 1)
		return
	}
	em := rack(ScaleEmblem)
	base := 2 * (box.Y + box.H)
	glow := charge(p)
	fold := func(ru int) float64 { return clamp01((p - 0.3 - float64(ru)*0.07) / 0.12) }
	tops := make([]int, containers)
	stack := base
	for ru := range containers {
		if fold(ru) >= 0.5 {
			stack -= 2
		} else {
			stack -= 4
		}
		tops[ru] = stack
	}
	for _, b := range L.bs {
		e := em[b.i]
		f := fold(b.ru)
		folded := f >= 0.5
		hp := 4
		if folded {
			hp = 2
		}
		vy := outCubic((p - 0.04 - float64(b.row)*0.015) / 0.24)
		vx := inOutCubic((p - 0.07 - float64(b.row)*0.02) / 0.3)
		py := 2 * rnd(lerpf(float64(2*L.T+b.py), float64(tops[b.ru]), vy)/2)
		k := outCubic(f)
		w := rnd(lerpf(float64(b.w), float64(e.w), k))
		x := rnd(lerpf(float64(L.lx), float64(box.X), vx) + lerpf(float64(b.x), float64(e.x), k))
		col, lum := c.tint(b, false)
		tick := 0.0
		if folded {
			tick = 0.7 * (1 - outCubic((f-0.5)/0.5))
		}
		DrawContainer(cv, pal.Palette, x, py, w, hp, flat(pal.Glow(col, math.Max(glow, tick))), lum)
		if vy > 0.05 && vy < 0.9 {
			for _, sx := range [2]int{2 * x, 2*(x+w) - 1} {
				for j := 1; j <= 4; j++ {
					a := 0.55 - float64(j)*0.12
					dot(cv, float64(sx), float64(2*(py+hp)+j*2), pal.Fade(pal.container(b.i), a), a*0.5)
				}
			}
		}
		c.drawLed(cv, b, x+w+1, (py+hp)/2-1, 1, 0)
	}
}

func (c *sctx) exitToDiamond(cv *scene.Canvas, L lay, p float64) {
	pal := c.pal
	dx, dy := L.cx, max(c.target.TitleAt.Y-1, 1)
	glow := charge(p)
	for _, b := range L.bs {
		u := clamp01((p - 0.08 - float64(b.row)*0.02 - float64(b.i&1)*0.008) / 0.19)
		if u >= 1 {
			continue
		}
		m := inCubic(u)
		w := max(1, rnd(lerpf(float64(b.w), 1, outQuad(u))))
		hp := max(1, rnd(lerpf(4, 1, outQuad(u))))
		cxp := lerpf(float64(L.lx+b.x)+float64(b.w)/2, float64(dx)+0.5, m)
		cyp := lerpf(float64(2*L.T+b.py+2), float64(2*dy+1), m)
		col, _ := c.tint(b, false)
		DrawContainer(cv, pal.Palette, rnd(cxp-float64(w)/2), rnd(cyp-float64(hp)/2), w, hp, flat(pal.Glow(col, math.Max(glow, m*0.8))), 0.9)
		if u < 0.5 {
			c.drawLed(cv, b, rnd(lerpf(float64(L.lx+b.ledX), float64(dx), m)), rnd(lerpf(float64(L.T+b.ledY), float64(dy), m)), 1-u*2, 0)
		}
	}
	born := outCubic((p - 0.2) / 0.1)
	if born <= 0 {
		return
	}
	path := func(v float64) (float64, float64) {
		return lerpf(float64(dx), 1, v), lerpf(float64(dy), 1, outCubic(math.Min(v/0.3, 1)))
	}
	flight := func(q float64) float64 { return inOutCubic((q - 0.34) / 0.46) }
	u := flight(p)
	col := mix(pal.Glow(pal.Sweep(0.1+p*0.5), 0.6), pal.UI.AccentText, smooth((p-0.45)/0.35))
	s := math.Sin(math.Pi * clamp01((p-0.2)/0.2))
	if s > 0.3 {
		put(cv, dx-1, dy, '─', pal.Fade(col, s*0.8), 0.5*s)
		put(cv, dx+1, dy, '─', pal.Fade(col, s*0.8), 0.5*s)
	}
	if s > 0.75 {
		put(cv, dx, dy-1, '│', pal.Fade(col, s*0.6), 0.4*s)
		put(cv, dx-3, dy, '·', pal.Fade(col, s*0.5), 0.4)
		put(cv, dx+3, dy, '·', pal.Fade(col, s*0.5), 0.4)
	}
	ax, ay := path(u)
	if u > 0 && u < 1 {
		bx, by := path(flight(p - 1.5/float64(ExitFrames)))
		n := rnd((bx - ax) * 2)
		for j := 1; j <= n; j++ {
			f := float64(j) / float64(n+1)
			a := (1 - f) * 0.8
			dot(cv, 2*ax+1+float64(j), 4*lerpf(ay, by, f)+1.5, pal.Fade(col, a), a*0.6)
		}
	}
	x, y := rnd(ax), rnd(ay)
	if p >= 0.88 {
		x, y = 1, 0
	}
	putB(cv, x, y, '◆', pal.Fade(col, born), born, true)
}

func (c *sctx) smallScene(cv *scene.Canvas) {
	const s = "◆  s e l f - h o s t"
	pal, t := c.pal, c.t
	y := (c.h - 1) / 2
	x := (c.w - len([]rune(s))) / 2
	exit := 1.0
	if c.phase == phExit {
		exit = 1 - smooth(c.exit/0.6)
	}
	for i, ch := range []rune(s) {
		a := exit
		if !c.reduced {
			a = outCubic((t-0.15-float64(i)*0.04)/0.5) * exit
		}
		if a <= 0 || ch == ' ' {
			continue
		}
		putB(cv, x+i, y, ch, pal.Fade(pal.Sweep(float64(i)*0.035-t*0.3), a), a, true)
	}
}

type landing struct {
	rows   [][]rune
	lines  []string
	tg     Target
	w, h   int
	chrome map[int]bool
}

func newLanding(tg Target, w, h int) *landing {
	l := &landing{lines: tg.Lines, tg: tg, w: w, h: h, chrome: map[int]bool{}}
	for _, y := range tg.Chrome {
		l.chrome[y] = true
	}
	for _, s := range tg.Lines {
		r := []rune(ansi.Strip(s))
		for len(r) < w {
			r = append(r, ' ')
		}
		l.rows = append(l.rows, r)
	}
	return l
}

func (l *landing) owned(x, y int) bool {
	tg := l.tg
	if y == tg.TitleAt.Y && x >= tg.TitleAt.X && x < tg.TitleAt.X+len([]rune(tg.Title)) {
		return true
	}
	e := tg.Emblem
	return e != nil && x >= e.X && x < e.X+e.W && y >= e.Y && y < e.Y+e.H
}

func (l *landing) alpha(y int, p float64, reduced bool) float64 {
	if reduced {
		return 1
	}
	if l.chrome[y] {
		return smooth((p - 0.55) / 0.45)
	}
	return smooth((p - 0.3) / 0.7)
}

func (l *landing) show(x, y int, a float64, row []rune, first, last int) bool {
	if a <= 0 || l.owned(x, y) {
		return false
	}
	if x < first-1 || x > last+1 {
		return false
	}
	if row[x] == ' ' && a <= 0.5 {
		return false
	}
	return true
}

func fadeLine(s string, pal Palette, a float64, noColor bool) string {
	if noColor {
		if a < 0.5 {
			return "\x1b[2m" + withoutColor(s) + "\x1b[m"
		}
		return withoutColor(s)
	}
	return sgr.ReplaceAllStringFunc(s, func(seq string) string {
		params := strings.Split(seq[2:len(seq)-1], ";")
		for i := 0; i+4 < len(params); i++ {
			if (params[i] == "38" || params[i] == "48") && params[i+1] == "2" {
				r, _ := strconv.Atoi(params[i+2])
				g, _ := strconv.Atoi(params[i+3])
				b, _ := strconv.Atoi(params[i+4])
				col := pal.Fade(scene.Hex(uint32(r<<16|g<<8|b)), a)
				params[i+2], params[i+3], params[i+4] = fmt.Sprint(col.R), fmt.Sprint(col.G), fmt.Sprint(col.B)
				i += 4
			}
		}
		return "\x1b[" + strings.Join(params, ";") + "m"
	})
}

func (l *landing) overlay(cv *scene.Canvas, p float64, pal Palette, noColor, reduced bool) []string {
	out := make([]string, cv.H)
	for y := range out {
		if y >= len(l.lines) {
			out[y] = cv.Row(y, noColor)
			continue
		}
		row := l.rows[y]
		first, last := -2, -2
		for x, r := range row {
			if r != ' ' {
				if first < 0 {
					first = x
				}
				last = x
			}
		}
		a := l.alpha(y, p, reduced)
		line := fadeLine(l.lines[y], pal, a, noColor)
		painted := cv.Row(y, noColor)
		var sb []byte
		for x := 0; x < cv.W; {
			from := l.show(x, y, a, row, first, last)
			end := x + 1
			for end < cv.W && l.show(end, y, a, row, first, last) == from {
				end++
			}
			if from {
				sb = append(sb, ansi.Cut(line, x, end)...)
			} else {
				sb = append(sb, ansi.Cut(painted, x, end)...)
			}
			x = end
		}
		out[y] = string(sb)
	}
	return out
}
