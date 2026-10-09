package preboot

import (
	"image/color"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

type cell struct {
	r    rune
	fg   color.RGBA
	lum  float64
	bold bool
}

// canvas is one frame as a grid of cells. A zero cell is empty.
type canvas struct {
	w, h  int
	cells []cell
}

func newCanvas(w, h int) *canvas { return &canvas{w: w, h: h, cells: make([]cell, w*h)} }

func (c *canvas) in(x, y int) bool { return x >= 0 && y >= 0 && x < c.w && y < c.h }

func (c *canvas) at(x, y int) cell {
	if !c.in(x, y) {
		return cell{}
	}
	return c.cells[y*c.w+x]
}

func (c *canvas) put(x, y int, r rune, fg color.RGBA, lum float64) {
	if c.in(x, y) {
		c.cells[y*c.w+x] = cell{r: r, fg: fg, lum: lum}
	}
}

// text writes s from x and returns the column after it.
func (c *canvas) text(x, y int, s string, fg color.RGBA, lum float64, bold bool) int {
	for _, r := range s {
		if c.in(x, y) {
			c.cells[y*c.w+x] = cell{r: r, fg: fg, lum: lum, bold: bold}
		}
		x++
	}
	return x
}

func (c *canvas) clear(x0, x1, y int) {
	for x := x0; x < x1; x++ {
		if c.in(x, y) {
			c.cells[y*c.w+x] = cell{}
		}
	}
}

// look is how a run of cells is drawn. Without colour, brightness becomes
// weight: bright cells are bold and dim ones faint.
type look struct {
	fg          color.RGBA
	bold, faint bool
	plain       bool
}

func (c cell) look(noColor bool) look {
	if c.r == 0 || c.r == ' ' {
		return look{plain: true}
	}
	if !noColor {
		return look{fg: c.fg, bold: c.bold}
	}
	bold := c.bold || c.lum >= 0.8
	return look{bold: bold, faint: !bold && c.lum < 0.35}
}

func (l look) apply(s string, noColor bool) string {
	if l.plain {
		return s
	}
	style := ansi.NewStyle()
	if l.bold {
		style = style.Bold()
	}
	if l.faint {
		style = style.Faint()
	}
	if !noColor {
		style = style.ForegroundColor(l.fg)
	}
	return style.Styled(s)
}

func (c *canvas) char(x, y int) rune {
	if r := c.cells[y*c.w+x].r; r != 0 {
		return r
	}
	return ' '
}

// styledCell is the single cell at x, y drawn on its own.
func (c *canvas) styledCell(x, y int, noColor bool) string {
	ce := c.cells[y*c.w+x]
	return ce.look(noColor).apply(string(c.char(x, y)), noColor)
}

func (c *canvas) row(y int, noColor bool) string {
	var sb, run strings.Builder
	var cur look
	flush := func() {
		if run.Len() > 0 {
			sb.WriteString(cur.apply(run.String(), noColor))
			run.Reset()
		}
	}
	for x := 0; x < c.w; x++ {
		k := c.cells[y*c.w+x].look(noColor)
		if k != cur {
			flush()
			cur = k
		}
		run.WriteRune(c.char(x, y))
	}
	flush()
	return sb.String()
}

func (c *canvas) lines(noColor bool) []string {
	out := make([]string, c.h)
	for y := range out {
		out[y] = c.row(y, noColor)
	}
	return out
}
