package scene

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestHalfBlockPixelsBakeIntoOneCell(t *testing.T) {
	c := New(4, 1)
	c.Px(0, 0, Dark().Gold, 1)
	c.Px(1, 1, Dark().Gold, 1)
	c.Px(2, 0, Dark().Gold, 1)
	c.Px(2, 1, Dark().Pink, 0.5)
	c.Flush()

	got := ansi.Strip(strings.Join(c.Lines(false), ""))

	if got != "▀▄█ " {
		t.Fatalf("got %q", got)
	}
	if c.At(2, 0).FG != Dark().Gold {
		t.Fatalf("the brighter half should colour the cell: %v", c.At(2, 0).FG)
	}
}

func TestPixelsAndDotsNeverCoverDrawnCells(t *testing.T) {
	c := New(2, 1)
	c.Put(0, 0, 'x', Dark().Text, 1)
	c.Px(0, 0, Dark().Gold, 1)
	c.Dot(2, 0, Dark().Gold, 1)
	c.Flush()

	if got := ansi.Strip(strings.Join(c.Lines(false), "")); got != "x⠁" {
		t.Fatalf("got %q", got)
	}
}

func TestWithoutColourBrightnessBecomesWeight(t *testing.T) {
	c := New(3, 1)
	c.Put(0, 0, 'a', Dark().Text, 1)
	c.Put(1, 0, 'b', Dark().Text, 0.2)
	c.Put(2, 0, 'c', Dark().Text, 0.5)

	got := strings.Join(c.Lines(true), "")

	if strings.Contains(got, "38;") || !strings.Contains(got, "\x1b[1m") || !strings.Contains(got, "\x1b[2m") {
		t.Fatalf("got %q", got)
	}
}
