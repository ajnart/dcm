package main

import (
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"strings"

	"github.com/ajnart/self-host/internal/intro"
	"github.com/ajnart/self-host/internal/scene"
)

func svg(pal intro.Palette) string {
	w, h := intro.ScaleFull.Size()
	cv := scene.New(w, h)
	colors := [4]color.RGBA{pal.Purple, pal.Pink, pal.Cyan, pal.Gold}
	intro.DrawLogo(cv, pal.Palette, intro.ScaleFull, 0, 0,
		func(i, c int) color.RGBA { return colors[i] },
		func(i int) color.RGBA { return pal.UI.OK })
	const cellW, cellH, pad = 12, 24, 12
	var out strings.Builder
	fmt.Fprintf(&out, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 %d %d\" role=\"img\" aria-labelledby=\"title desc\">\n", w*cellW+2*pad, h*cellH+2*pad)
	out.WriteString("  <title id=\"title\">self-host Logo</title>\n")
	out.WriteString("  <desc id=\"desc\">Four aligned shipping containers: gold, cyan, pink and purple, each with a lit status light.</desc>\n")
	for y := range h {
		for x := range w {
			cell := cv.At(x, y)
			fill := fmt.Sprintf("#%02x%02x%02x", cell.FG.R, cell.FG.G, cell.FG.B)
			x0, y0 := pad+x*cellW, pad+y*cellH
			switch cell.R {
			case '█':
				fmt.Fprintf(&out, "  <rect x=\"%d\" y=\"%d\" width=\"12\" height=\"24\" fill=\"%s\"/>\n", x0, y0, fill)
			case '▀':
				fmt.Fprintf(&out, "  <rect x=\"%d\" y=\"%d\" width=\"12\" height=\"12\" fill=\"%s\"/>\n", x0, y0, fill)
			case '▄':
				fmt.Fprintf(&out, "  <rect x=\"%d\" y=\"%d\" width=\"12\" height=\"12\" fill=\"%s\"/>\n", x0, y0+12, fill)
			case '●':
				fmt.Fprintf(&out, "  <circle cx=\"%d\" cy=\"%d\" r=\"4\" fill=\"%s\"/>\n", x0+6, y0+12, fill)
			}
		}
	}
	out.WriteString("</svg>\n")
	return out.String()
}

func run() error {
	dir := filepath.Join("docs", "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, variant := range []struct {
		name string
		pal  intro.Palette
	}{{"dark", intro.Dark()}, {"light", intro.Light()}} {
		path := filepath.Join(dir, "logo-"+variant.name+".svg")
		if err := os.WriteFile(path, []byte(svg(variant.pal)), 0o644); err != nil {
			return err
		}
		fmt.Println(path)
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
