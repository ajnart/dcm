package intro

import (
	"image/color"
	"regexp"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/scene"
	"github.com/charmbracelet/x/ansi"
)

// Render draws one Intro frame, exactly H rows of W terminal cells.
func Render(in Input) []string {
	return render(in, 0, false, Target{})
}

// RenderExit draws exit frame n into Welcome; frame ExitFrames-1 is Target.Lines.
func RenderExit(in Input, n int, target Target) []string {
	if in.Reduced || n >= ExitFrames-1 {
		return fitLines(target.Lines, in.W, in.H, in.NoColor)
	}
	return render(in, max(n, 0), true, target)
}

func fitLines(lines []string, w, h int, noColor bool) []string {
	out := make([]string, max(h, 0))
	for y := range out {
		if y < len(lines) {
			out[y] = lines[y]
		}
		if noColor {
			out[y] = withoutColor(out[y])
		}
		out[y] = ansi.Truncate(out[y], max(w, 0), "")
		out[y] += strings.Repeat(" ", max(w-ansi.StringWidth(out[y]), 0))
	}
	return out
}

var sgr = regexp.MustCompile("\x1b\\[[0-9;:]*m")

func withoutColor(s string) string {
	return sgr.ReplaceAllStringFunc(s, func(seq string) string {
		params := strings.Split(seq[2:len(seq)-1], ";")
		var keep []string
		for i := 0; i < len(params); i++ {
			if strings.Contains(params[i], ":") {
				continue
			}
			n, _ := strconv.Atoi(params[i])
			switch n {
			case 0, 1, 2, 22:
				keep = append(keep, params[i])
			case 38, 48, 58:
				if i+1 < len(params) {
					mode := params[i+1]
					i += 2
					if mode == "2" {
						i += 2
					}
				}
			}
		}
		return "\x1b[" + strings.Join(keep, ";") + "m"
	})
}

func render(in Input, n int, exiting bool, target Target) []string {
	if in.W <= 0 || in.H <= 0 {
		return fitLines(nil, in.W, in.H, false)
	}
	if exiting {
		target.Lines = fitLines(target.Lines, in.W, in.H, in.NoColor)
	}
	c := newCtx(in, n, exiting, target)
	cv := renderCanvas(c)
	if exiting {
		if c.tier == tierSmall {
			target.Title, target.Emblem = "", nil
		}
		return fitLines(newLanding(target, in.W, in.H).overlay(cv, c.exit, c.pal, in.NoColor, in.Reduced), in.W, in.H, false)
	}
	return fitLines(cv.Lines(in.NoColor), in.W, in.H, false)
}

func renderCanvas(c *sctx) *scene.Canvas {
	cv := scene.New(c.w, c.h)
	if c.tier == tierSmall {
		c.smallScene(cv)
	} else {
		c.scene(cv)
	}
	cv.Flush()
	c.clipScene(cv)
	c.dimScene(cv)
	c.drawCard(cv)
	c.drawFooter(cv)
	return cv
}

type cardLine struct {
	text string
	kind int
}

func wrap(s string, width int) []string {
	width = max(width, 1)
	var out []string
	line := ""
	for _, word := range strings.Fields(s) {
		if line != "" && ansi.StringWidth(line)+1+ansi.StringWidth(word) > width {
			out = append(out, line)
			line = ""
		}
		for ansi.StringWidth(word) > width {
			out = append(out, ansi.Cut(word, 0, width))
			word = ansi.Cut(word, width, ansi.StringWidth(word))
		}
		if line != "" {
			line += " "
		}
		line += word
	}
	if line != "" {
		out = append(out, line)
	}
	return out
}

func cardLines(w int, card *cardInfo) []cardLine {
	inner := max(min(w-6, 84)-4, 1)
	var out []cardLine
	add := func(text string, kind int) {
		for _, s := range wrap(text, inner) {
			out = append(out, cardLine{s, kind})
		}
	}
	add(card.check.Detail, 0)
	if card.check.Hint != "" {
		add("→ "+card.check.Hint, 1)
	}
	if card.check.Docs != "" {
		out = append(out, cardLine{ansi.Truncate(card.check.Docs, inner, "…"), 2})
	}
	if card.kind == Fail {
		out = append(out, cardLine{"", 2})
		add("Onboarding cannot continue while a check fails.", 2)
	}
	return out
}

func cardBox(w, h int, card *cardInfo) rect {
	cw := max(min(w-6, 84), 4)
	x := (w - cw) / 2
	y1 := h - 2
	return rect{x, max(y1-len(cardLines(w, card))-2, 0), x + cw, y1}
}

func (c *sctx) drawCard(cv *scene.Canvas) {
	card := c.card
	if card == nil {
		return
	}
	a, dy := 1.0, 0
	if !c.reduced {
		a = outCubic(float64(c.wall-card.since) / (0.3 * FPS))
		dy = rnd((1 - a) * 2)
	}
	if card.out >= 0 {
		o := 1.0
		if !c.reduced {
			o = inCubic(float64(c.wall-card.out) / (0.25 * FPS))
		}
		a *= 1 - o
		dy += rnd(o * 2)
	}
	if a <= 0.02 {
		return
	}
	r := cardBox(c.w, c.h, card)
	y := r.y0 + dy
	border := c.pal.Fade(c.pal.level(card.kind), a)
	ch := "!"
	if card.kind == Fail {
		ch = "✗"
	}
	head := ansi.Truncate(" "+ch+" "+card.check.Title+" ", max(r.x1-r.x0-4, 1), "…")
	text := func(x, y int, s string, col color.RGBA, lum float64, bold bool) {
		if y < c.h-1 {
			cv.Text(x, y, s, col, lum, bold)
		}
	}
	text(r.x0, y, "╭─"+head+strings.Repeat("─", max(r.x1-r.x0-3-ansi.StringWidth(head), 0))+"╮", border, a, true)
	lines := cardLines(c.w, card)
	for i, line := range lines {
		yy := y + i + 1
		col, lum := c.pal.UI.Text, 0.6
		switch line.kind {
		case 1:
			col, lum = c.pal.UI.Warn, 0.5
		case 2:
			col, lum = c.pal.UI.Muted, 0.5
		}
		text(r.x0, yy, "│", border, a, false)
		text(r.x1-1, yy, "│", border, a, false)
		text(r.x0+2, yy, line.text, c.pal.Fade(col, a), lum*a, false)
	}
	text(r.x0, y+len(lines)+1, "╰"+strings.Repeat("─", max(r.x1-r.x0-2, 0))+"╯", border, a, false)
}

func (c *sctx) drawFooter(cv *scene.Canvas) {
	a := 1.0
	if c.phase == phExit {
		a = 1 - smooth((c.exit-0.15)/0.4)
	}
	if a <= 0 {
		return
	}
	u, d := c.pal.UI, c.doc
	right := "enter skip · q quit"
	spin := []rune("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")[(max(c.wall, 0)/2)%10]
	left, col, since := string(spin)+" Checking this machine…", u.Muted, 0
	n := Ticked(c.wall, d)
	switch {
	case d.Reading:
		if d.Again {
			left = string(spin) + " Checking again…"
		}
	case n == 0:
	case c.wall < d.litAt(len(d.Checks)):
		check := d.Checks[n-1]
		gl := "✓"
		col = u.OK
		if check.Level == Warn {
			gl, col = "!", u.Warn
		} else if check.Level == Fail {
			gl, col = "✗", u.Fail
		}
		left = gl + " " + check.Title + "  " + check.Detail
		since = d.litAt(n - 1)
	case Worst(d) == Fail:
		for _, check := range d.Checks {
			if check.Level == Fail {
				left = "✗ " + check.Title + " failed. Press r to retry."
				break
			}
		}
		col, right, since = u.Fail, "r check again · q quit", d.litAt(len(d.Checks))
	case d.SettingsReading:
		left, since = "Reading this machine's settings…", d.litAt(len(d.Checks))
	default:
		left, col, since = "✓ This machine is ready.", u.OK, d.litAt(len(d.Checks))
		if Worst(d) == Warn {
			left += " Warnings do not stop the install."
			right = "enter continue · q quit"
		}
	}
	rw := ansi.StringWidth(right)
	left = ansi.Truncate(left, max(c.w-rw-4, 0), "…")
	fresh := 1.0
	if !c.reduced {
		fresh = 0.35 + 0.65*outCubic(float64(c.wall-since)/4)
	}
	cv.Clear(0, c.w, c.h-1)
	cv.Text(1, c.h-1, left, c.pal.Fade(col, a*fresh), 0.8*a*fresh, false)
	cv.Text(max(c.w-rw-1, 0), c.h-1, right, c.pal.Fade(u.Faint, a), 0.25*a, false)
}
