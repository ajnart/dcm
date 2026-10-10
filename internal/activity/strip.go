package activity

import "github.com/charmbracelet/x/ansi"

// Strip is the Action in at most three lines, for a glance such as the
// Overview's Now strip: the title with its spinner or outcome, then the
// overall pull bar while pulling or else the stages with the icons of glyph
// set g, then the narrative.
// A failed Action's narrative names its error.
func Strip(s Snapshot, m Motion, width int, g Glyphs, p Palette) []string {
	a := s.Action
	if a.Empty() {
		return nil
	}
	r := renderer{a: a, m: m, g: g, p: p, narrow: width < wideBoxes}
	lines := []string{r.title()}
	switch {
	case s.Pull.Pulling:
		lines = append(lines, "  "+Compact(s, width-2, p))
	case len(a.Stages) > 0:
		lines = append(lines, "  "+r.stages())
	}
	lines = append(lines, r.narrative()...)
	for i, line := range lines {
		lines[i] = ansi.Truncate(line, width, "…")
	}
	return lines
}
