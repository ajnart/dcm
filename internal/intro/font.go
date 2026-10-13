package intro

var glyphs = [9][7]string{
	{".....", ".....", ".####", "#....", ".###.", "....#", "####."},
	{".....", ".....", ".###.", "#...#", "#####", "#....", ".###."},
	{".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."},
	{"..##.", ".#...", "####.", ".#...", ".#...", ".#...", ".#..."},
	{".....", ".....", ".....", ".###.", ".....", ".....", "....."},
	{"#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"},
	{".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."},
	{".....", ".....", ".####", "#....", ".###.", "....#", "####."},
	{".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##."},
}

var ink = [9][2]int{{0, 4}, {0, 4}, {1, 3}, {0, 3}, {0, 4}, {0, 4}, {0, 4}, {0, 4}, {0, 4}}

const (
	markH  = 7
	cipher = "ABCDEFGHJKLMNPQRSTUVWXYZabdeghkmnpqrsuvwxyz0123456789#%&*+=<>/\\?$@░▒▓╳◆✦"
)

var cipherRunes = []rune(cipher)

type mark struct {
	w      int
	rows   [markH][]bool
	starts [9]int
}

func (m *mark) on(x, y int) bool {
	return x >= 0 && y >= 0 && x < m.w && y < markH && m.rows[y][x]
}

func (m *mark) span(g0, g1 int) (int, int) {
	return m.starts[g0], m.starts[g1] + ink[g1][1] - ink[g1][0]
}

func newMark() *mark {
	m := &mark{}
	x := 0
	for i, in := range ink {
		m.starts[i] = x
		x += in[1] - in[0] + 2
	}
	m.w = x - 1
	for y := range m.rows {
		m.rows[y] = make([]bool, m.w)
	}
	for gi, in := range ink {
		for c := in[0]; c <= in[1]; c++ {
			for y := range markH {
				m.rows[y][m.starts[gi]+c-in[0]] = glyphs[gi][y][c] == '#'
			}
		}
	}
	return m
}

type wcell struct {
	dc, dr int
	nx, n  float64
	glyph  rune
	hue    float64
	th     float64
}

type ghost struct {
	dc, dr int
	life   float64
}

type wordmark struct {
	s, W, H, R int
	cells      []wcell
	ghosts     []ghost
}

var (
	theMark = newMark()
	words   = [3]*wordmark{nil, buildWord(1), buildWord(2)}
	centres = func() [4]float64 {
		var out [4]float64
		for i, p := range [4][2]int{{0, 1}, {2, 4}, {5, 6}, {7, 8}} {
			a, b := theMark.span(p[0], p[1])
			out[i] = float64(a+b) / 2
		}
		return out
	}()
)

func hueAt(bx float64) float64 {
	if bx <= centres[0] {
		return 0
	}
	if bx >= centres[3] {
		return 0.75
	}
	i := 0
	for bx > centres[i+1] {
		i++
	}
	return (float64(i) + (bx-centres[i])/(centres[i+1]-centres[i])) * 0.25
}

func buildWord(s int) *wordmark {
	m := theMark
	W, H := m.w*s, markH*s
	px := make([]bool, W*H)
	for y := range markH {
		for x := range m.w {
			p := m.on(x, y)
			if s == 1 {
				px[y*W+x] = p
				continue
			}
			a, b, c, d := m.on(x, y-1), m.on(x+1, y), m.on(x-1, y), m.on(x, y+1)
			pick := func(cond bool, v bool) bool {
				if cond {
					return v
				}
				return p
			}
			quads := [4]bool{
				pick(c == a && c != d && a != b, a),
				pick(a == b && a != c && b != d, b),
				pick(d == c && d != b && c != a, c),
				pick(b == d && b != a && d != c, d),
			}
			for q, on := range quads {
				if on {
					px[(2*y+(q>>1))*W+2*x+(q&1)] = true
				}
			}
		}
	}
	parity := 0
	if s == 1 {
		parity = 1
	}
	R := (parity+H-1)/2 + 1
	w := &wordmark{s: s, W: W, H: H, R: R}
	foot := map[int]bool{}
	at := func(r, c int) bool {
		return r >= 0 && r < H && px[r*W+c]
	}
	for dr := range R {
		for dc := range W {
			pt := 2*dr - parity
			a, b := at(pt, dc), at(pt+1, dc)
			if !a && !b {
				continue
			}
			glyph := '▄'
			switch {
			case a && b:
				glyph = '█'
			case a:
				glyph = '▀'
			}
			nx := float64(dc) / float64(W-1)
			w.cells = append(w.cells, wcell{dc: dc, dr: dr, nx: nx, n: noise(dc, dr, 53), glyph: glyph,
				hue: hueAt((float64(dc)+0.5)/float64(s) - 0.5),
				th:  0.1 + 0.75*(0.55*(1-nx)+0.45*noise(dc, dr, 59))})
			foot[dr*W+dc] = true
		}
	}
	for dr := -1; dr <= R; dr++ {
		for dc := range W {
			if foot[dr*W+dc] {
				continue
			}
			p := 0.09
			if dr < 0 || dr == R {
				p = 0.05
			}
			if noise(dc, dr+9, 31+s) < p {
				w.ghosts = append(w.ghosts, ghost{dc: dc, dr: dr, life: 0.14 + 0.3*noise(dc, dr, 33)})
			}
		}
	}
	return w
}

func cipherGlyph(a, b, k int) rune {
	return cipherRunes[int(noise(a, b, k)*float64(len(cipherRunes)))]
}
