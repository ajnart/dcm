package activity

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// Palette is the colour of each role the renderer draws with. A nil colour
// draws without colour.
type Palette struct {
	Accent, AccentText, OK, Warn, Fail, Bright, Text, Muted, Faint color.Color
}

const (
	labelWidth   = 20
	maxBarWidth  = 48
	compactWidth = 12
)

// PullBlock draws the pull block of the snapshot within width cells: a header
// with the overall bar and the images done, then one slim bar per image. A
// failed pull marks its unfinished images with ✗.
func PullBlock(s Snapshot, width int, p Palette) []string {
	pull := s.Pull
	if len(pull.Images) == 0 {
		return nil
	}
	fact := imagesFact(pull)
	bar := min(width-labelWidth-2-2-ansi.StringWidth(fact), maxBarWidth)
	bar = max(bar, 4)
	title := "Pull"
	if pull.Pulling {
		title = "Pulling"
	} else if pull.Done == pull.Total {
		title = "Pulled"
	}
	head := style(p.Text).Bold(true).Render(pad(title, labelWidth+2))
	if pull.Failed {
		head = style(p.Fail).Render("✗") + " " + style(p.Text).Bold(true).Render(pad("Pull failed", labelWidth))
	}
	header := head + heavyBar(pull.Fraction, bar, p) + "  " + style(p.Muted).Render(fact)
	lines := []string{ansi.Truncate(header, width, "…")}
	for _, img := range pull.Images {
		label := ansi.Truncate(img.Label, labelWidth-1, "…")
		line := "  " + style(p.Text).Render(pad(label, labelWidth)) + SlimBar(img.Fraction, bar, p)
		if img.Done {
			line += "  " + style(p.OK).Render("✓")
		} else if pull.Failed {
			line += "  " + style(p.Fail).Render("✗")
		}
		lines = append(lines, ansi.Truncate(line, width, "…"))
	}
	return lines
}

// Compact is the one-line form of the pull: a short overall bar and the
// images done.
func Compact(s Snapshot, width int, p Palette) string {
	pull := s.Pull
	if len(pull.Images) == 0 {
		return ""
	}
	fact := imagesFact(pull)
	bar := max(min(compactWidth, width-2-ansi.StringWidth(fact)), 1)
	return ansi.Truncate(heavyBar(pull.Fraction, bar, p)+"  "+style(p.Muted).Render(fact), width, "…")
}

func imagesFact(pull Pull) string {
	noun := "images"
	if pull.Total == 1 {
		noun = "image"
	}
	return fmt.Sprintf("%d of %d %s", pull.Done, pull.Total, noun)
}

// heavyBar fills cells in eighths of a cell over a shaded track.
func heavyBar(fraction float64, cells int, p Palette) string {
	eighths := int(clamp(fraction) * float64(cells*8))
	full := eighths / 8
	fill := strings.Repeat("█", full)
	rest := cells - full
	if part := eighths % 8; part > 0 {
		fill += string([]rune("▏▎▍▌▋▊▉")[part-1])
		rest--
	}
	return style(p.Accent).Render(fill) + style(p.Faint).Render(strings.Repeat("░", rest))
}

// SlimBar fills cells in halves of a cell over a thin line.
func SlimBar(fraction float64, cells int, p Palette) string {
	halves := int(clamp(fraction) * float64(cells*2))
	full := halves / 2
	fill := strings.Repeat("━", full)
	rest := cells - full
	if halves%2 == 1 {
		fill += "╸"
		rest--
	}
	return style(p.Accent).Render(fill) + style(p.Faint).Render(strings.Repeat("─", rest))
}

func clamp(f float64) float64 {
	return min(max(f, 0), 1)
}

func style(c color.Color) lipgloss.Style {
	s := lipgloss.NewStyle()
	if c != nil {
		s = s.Foreground(c)
	}
	return s
}

func pad(s string, width int) string {
	return s + strings.Repeat(" ", max(width-ansi.StringWidth(s), 0))
}
