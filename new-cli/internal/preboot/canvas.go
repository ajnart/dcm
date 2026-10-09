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
	// dots is the braille layer: eight sub-dots a cell, merged under the
	// cells by flush.
	dots   []uint8
	dotFG  []color.RGBA
	dotLum []float64
}

func newCanvas(w, h int) *canvas {
	return &canvas{w: w, h: h, cells: make([]cell, w*h), dots: make([]uint8, w*h),
		dotFG: make([]color.RGBA, w*h), dotLum: make([]float64, w*h)}
}

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

// dot sets one braille sub-dot, sx in [0, 2w) and sy in [0, 4h).
func (c *canvas) dot(sx, sy int, fg color.RGBA, lum float64) {
	cx, cy := sx>>1, sy>>2
	if sx < 0 || sy < 0 || !c.in(cx, cy) {
		return
	}
	bit := [4][2]uint8{{0x01, 0x08}, {0x02, 0x10}, {0x04, 0x20}, {0x40, 0x80}}[sy&3][sx&1]
	i := cy*c.w + cx
	c.dots[i] |= bit
	c.dotFG[i] = fg
	c.dotLum[i] = max(c.dotLum[i], lum)
}

// flush puts the braille layer under whatever the cells already hold.
func (c *canvas) flush() {
	for i, m := range c.dots {
		if m == 0 {
			continue
		}
		if c.cells[i].r == 0 {
			c.cells[i] = cell{r: 0x2800 + rune(m), fg: c.dotFG[i], lum: c.dotLum[i]}
		}
		c.dots[i], c.dotLum[i] = 0, 0
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
