// Package scene is the drawing toolkit of the full-screen scenes (Pre-boot
// and the Intro): a canvas of cells with a braille layer and a half-block
// layer, the scenes' palette, and repeatable noise.
//
// Without colour, brightness becomes weight: bright cells are bold and dim
// ones faint, so the motion survives NO_COLOR.
package scene

import (
	"image/color"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// Cell is one terminal cell. The zero Cell is empty.
type Cell struct {
	R    rune
	FG   color.RGBA
	Lum  float64
	Bold bool
}

// Canvas is one frame as a grid of cells. A zero cell is empty.
type Canvas struct {
	W, H  int
	Cells []Cell
	// dots is the braille layer: eight sub-dots a cell, merged under the
	// cells by Flush.
	dots   []uint8
	dotFG  []color.RGBA
	dotLum []float64
	// top and bot are the half-block layer: two pixels a cell, one above
	// the other, baked into ▀ ▄ █ by Flush.
	top, bot       []color.RGBA
	topLum, botLum []float64
	topOn, botOn   []bool
}

// New is an empty canvas of w columns and h rows.
func New(w, h int) *Canvas {
	n := w * h
	return &Canvas{W: w, H: h, Cells: make([]Cell, n), dots: make([]uint8, n),
		dotFG: make([]color.RGBA, n), dotLum: make([]float64, n),
		top: make([]color.RGBA, n), bot: make([]color.RGBA, n),
		topLum: make([]float64, n), botLum: make([]float64, n),
		topOn: make([]bool, n), botOn: make([]bool, n)}
}

// In reports whether x, y is on the canvas.
func (c *Canvas) In(x, y int) bool { return x >= 0 && y >= 0 && x < c.W && y < c.H }

// At is the cell at x, y; off the canvas it is empty.
func (c *Canvas) At(x, y int) Cell {
	if !c.In(x, y) {
		return Cell{}
	}
	return c.Cells[y*c.W+x]
}

// Put draws one glyph.
func (c *Canvas) Put(x, y int, r rune, fg color.RGBA, lum float64) {
	if c.In(x, y) {
		c.Cells[y*c.W+x] = Cell{R: r, FG: fg, Lum: lum}
	}
}

// PutBold draws one bold glyph.
func (c *Canvas) PutBold(x, y int, r rune, fg color.RGBA, lum float64, bold bool) {
	if c.In(x, y) {
		c.Cells[y*c.W+x] = Cell{R: r, FG: fg, Lum: lum, Bold: bold}
	}
}

// Blank draws a space, which hides what a later Flush would put there.
func (c *Canvas) Blank(x, y int) {
	if c.In(x, y) {
		c.Cells[y*c.W+x] = Cell{R: ' '}
	}
}

// Text writes s from x and returns the column after it.
func (c *Canvas) Text(x, y int, s string, fg color.RGBA, lum float64, bold bool) int {
	for _, r := range s {
		if c.In(x, y) {
			c.Cells[y*c.W+x] = Cell{R: r, FG: fg, Lum: lum, Bold: bold}
		}
		x++
	}
	return x
}

// Clear empties [x0, x1) of row y.
func (c *Canvas) Clear(x0, x1, y int) {
	for x := x0; x < x1; x++ {
		if c.In(x, y) {
			c.Cells[y*c.W+x] = Cell{}
		}
	}
}

// Dot sets one braille sub-dot, sx in [0, 2w) and sy in [0, 4h).
func (c *Canvas) Dot(sx, sy int, fg color.RGBA, lum float64) {
	cx, cy := sx>>1, sy>>2
	if sx < 0 || sy < 0 || !c.In(cx, cy) {
		return
	}
	bit := [4][2]uint8{{0x01, 0x08}, {0x02, 0x10}, {0x04, 0x20}, {0x40, 0x80}}[sy&3][sx&1]
	i := cy*c.W + cx
	c.dots[i] |= bit
	c.dotFG[i] = fg
	c.dotLum[i] = max(c.dotLum[i], lum)
}

// Px sets one half-block pixel, x in [0, w) and py in [0, 2h). The two
// halves of a cell share one colour, the brighter one, since nothing here
// paints a background.
func (c *Canvas) Px(x, py int, fg color.RGBA, lum float64) {
	cy := py >> 1
	if x < 0 || py < 0 || !c.In(x, cy) {
		return
	}
	i := cy*c.W + x
	if py&1 == 1 {
		if !c.botOn[i] || lum >= c.botLum[i] {
			c.bot[i], c.botLum[i], c.botOn[i] = fg, lum, true
		}
		return
	}
	if !c.topOn[i] || lum >= c.topLum[i] {
		c.top[i], c.topLum[i], c.topOn[i] = fg, lum, true
	}
}

// Flush puts the half-block layer, then the braille layer, under whatever
// the cells already hold, and clears both layers.
func (c *Canvas) Flush() {
	for i := range c.Cells {
		if c.topOn[i] || c.botOn[i] {
			if c.Cells[i].R == 0 {
				ch, fg, lum := '█', c.top[i], c.topLum[i]
				switch {
				case c.topOn[i] && c.botOn[i]:
					if c.botLum[i] > lum {
						fg, lum = c.bot[i], c.botLum[i]
					}
				case c.topOn[i]:
					ch = '▀'
				default:
					ch, fg, lum = '▄', c.bot[i], c.botLum[i]
				}
				c.Cells[i] = Cell{R: ch, FG: fg, Lum: lum}
			}
			c.topOn[i], c.botOn[i], c.topLum[i], c.botLum[i] = false, false, 0, 0
		}
		m := c.dots[i]
		if m == 0 {
			continue
		}
		if c.Cells[i].R == 0 {
			c.Cells[i] = Cell{R: 0x2800 + rune(m), FG: c.dotFG[i], Lum: c.dotLum[i]}
		}
		c.dots[i], c.dotLum[i] = 0, 0
	}
}

// Look is how a run of cells is drawn.
type Look struct {
	FG          color.RGBA
	Bold, Faint bool
	Plain       bool
}

// Look is how the cell is drawn, with colour or without.
func (c Cell) Look(noColor bool) Look {
	if c.R == 0 || c.R == ' ' {
		return Look{Plain: true}
	}
	if !noColor {
		return Look{FG: c.FG, Bold: c.Bold}
	}
	bold := c.Bold || c.Lum >= 0.8
	return Look{Bold: bold, Faint: !bold && c.Lum < 0.35}
}

// Apply styles s as the look says.
func (l Look) Apply(s string, noColor bool) string {
	if l.Plain {
		return s
	}
	style := ansi.NewStyle()
	if l.Bold {
		style = style.Bold()
	}
	if l.Faint {
		style = style.Faint()
	}
	if !noColor {
		style = style.ForegroundColor(l.FG)
	}
	return style.Styled(s)
}

// Char is the glyph at x, y, a space where the cell is empty.
func (c *Canvas) Char(x, y int) rune {
	if r := c.Cells[y*c.W+x].R; r != 0 {
		return r
	}
	return ' '
}

// StyledCell is the single cell at x, y drawn on its own.
func (c *Canvas) StyledCell(x, y int, noColor bool) string {
	ce := c.Cells[y*c.W+x]
	return ce.Look(noColor).Apply(string(c.Char(x, y)), noColor)
}

// Row is row y drawn with runs of equal look joined.
func (c *Canvas) Row(y int, noColor bool) string {
	var sb, run strings.Builder
	var cur Look
	flush := func() {
		if run.Len() > 0 {
			sb.WriteString(cur.Apply(run.String(), noColor))
			run.Reset()
		}
	}
	for x := 0; x < c.W; x++ {
		k := c.Cells[y*c.W+x].Look(noColor)
		if k != cur {
			flush()
			cur = k
		}
		run.WriteRune(c.Char(x, y))
	}
	flush()
	return sb.String()
}

// Lines is every row, one string each.
func (c *Canvas) Lines(noColor bool) []string {
	out := make([]string, c.H)
	for y := range out {
		out[y] = c.Row(y, noColor)
	}
	return out
}
