package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/intro"
)

const (
	width  = 100
	height = 28
	tail   = 0
)

type cell struct {
	ch     rune
	fg, bg string
	bold   bool
}

type style struct {
	fg, bg string
	bold   bool
}

func color(params []string, i int) (string, int) {
	if i+1 >= len(params) {
		return "", i
	}
	switch params[i+1] {
	case "2":
		if i+4 < len(params) {
			r, _ := strconv.Atoi(params[i+2])
			g, _ := strconv.Atoi(params[i+3])
			b, _ := strconv.Atoi(params[i+4])
			return fmt.Sprintf("#%02x%02x%02x", r, g, b), i + 4
		}
	case "5":
		if i+2 < len(params) {
			n, _ := strconv.Atoi(params[i+2])
			return xterm(n), i + 2
		}
	}
	return "", i
}

func xterm(n int) string {
	base := []string{"#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5", "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"}
	switch {
	case n < 16:
		return base[n]
	case n < 232:
		n -= 16
		step := []int{0, 95, 135, 175, 215, 255}
		return fmt.Sprintf("#%02x%02x%02x", step[n/36], step[n/6%6], step[n%6])
	}
	v := 8 + (n-232)*10
	return fmt.Sprintf("#%02x%02x%02x", v, v, v)
}

func apply(st *style, seq string) {
	params := strings.FieldsFunc(seq, func(r rune) bool { return r == ';' || r == ':' })
	if len(params) == 0 {
		*st = style{}
		return
	}
	for i := 0; i < len(params); i++ {
		switch params[i] {
		case "0":
			*st = style{}
		case "1":
			st.bold = true
		case "22":
			st.bold = false
		case "39":
			st.fg = ""
		case "49":
			st.bg = ""
		case "38":
			st.fg, i = color(params, i)
		case "48":
			st.bg, i = color(params, i)
		}
	}
}

func parse(lines []string) []cell {
	grid := make([]cell, width*height)
	for y, line := range lines {
		if y >= height {
			break
		}
		st := style{}
		x := 0
		rs := []rune(line)
		for i := 0; i < len(rs); i++ {
			if rs[i] == 0x1b && i+1 < len(rs) && rs[i+1] == '[' {
				j := i + 2
				for j < len(rs) && (rs[j] < '@' || rs[j] > '~') {
					j++
				}
				if j < len(rs) && rs[j] == 'm' {
					apply(&st, string(rs[i+2:j]))
				}
				i = j
				continue
			}
			if x < width {
				grid[y*width+x] = cell{ch: rs[i], fg: st.fg, bg: st.bg, bold: st.bold}
			}
			x++
		}
	}
	return grid
}

type film struct {
	W      int             `json:"w"`
	H      int             `json:"h"`
	FPS    int             `json:"fps"`
	Styles []string        `json:"styles"`
	Frames [][]interface{} `json:"frames"`
}

func run() error {
	checks := []intro.Check{
		{Title: "Docker", Detail: "docker command found", Level: intro.OK},
		{Title: "Docker daemon", Detail: "engine 29.8.2", Level: intro.OK},
		{Title: "Docker Compose", Detail: "v2.40.1", Level: intro.OK},
		{Title: "Access", Detail: "home network", Level: intro.OK},
	}
	doctor := intro.Doctor{Checks: checks, TickFrom: intro.TickStart(0, false)}
	frames := intro.SceneFrames
	for !intro.Ready(frames, doctor) {
		frames++
	}
	frames += tail
	styles := map[string]int{}
	f := film{W: width, H: height, FPS: intro.FPS}
	styleOf := func(c cell) int {
		key := c.fg + "|" + c.bg
		if c.bold {
			key += "|b"
		}
		if id, ok := styles[key]; ok {
			return id
		}
		styles[key] = len(f.Styles)
		f.Styles = append(f.Styles, key)
		return styles[key]
	}
	var prev []cell
	for n := 0; n < frames; n++ {
		in := intro.Input{W: width, H: height, Frame: min(n, intro.SceneFrames), Wall: n, Doctor: doctor, Pal: intro.Dark()}
		grid := parse(intro.Render(in))
		var delta []interface{}
		for i, c := range grid {
			if prev != nil && prev[i] == c {
				continue
			}
			ch := c.ch
			if ch == 0 {
				ch = ' '
			}
			delta = append(delta, i, string(ch), styleOf(c))
		}
		f.Frames = append(f.Frames, delta)
		prev = grid
	}
	data, err := json.Marshal(f)
	if err != nil {
		return err
	}
	path := filepath.Join("site", "intro.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return err
	}
	fmt.Printf("%s: %d frames, %d styles, %d bytes\n", path, len(f.Frames), len(f.Styles), len(data))
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
