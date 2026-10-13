package intro

import (
	"image/color"
	"math"

	"github.com/ajnart/self-host/internal/scene"
)

// Choice is the Experience level on Welcome.
type Choice int

const (
	// New is the warm, soft Ink reaction.
	New Choice = iota
	// Advanced is the cool, hard-edged Ink reaction.
	Advanced
)

// Reaction is Welcome's focus and selection, with ages counted at FPS.
// Negative ages mean no reaction; Reduced disables both one-shots.
type Reaction struct {
	Focus, PrevFocus       Choice
	Selected, PrevSelected Choice
	FocusAge, SelectAge    int
	Levels                 [4]Level
	Pal                    Palette
	NoColor, Reduced       bool
}

// FocusActive reports whether Welcome's focus one-shot still needs frames.
func FocusActive(r Reaction) bool {
	return !r.Reduced && r.Focus != r.PrevFocus && r.FocusAge >= 0 && r.FocusAge < FocusFrames
}

// SelectionActive reports whether Welcome's selection one-shot needs frames.
func SelectionActive(r Reaction) bool {
	return !r.Reduced && r.Selected != r.PrevSelected && r.SelectAge >= 0 && r.SelectAge < SelectFrames
}

// CaptionText is the focused choice's caption at rest.
func CaptionText(choice Choice) string {
	if choice == Advanced {
		return "Tailors self-host to you: fewer explanations."
	}
	return "Tailors self-host to you: more help along the way."
}

func reactionTone(p Palette, lv Choice, u float64) color.RGBA {
	if lv == Advanced {
		return mix(p.Cyan, p.Purple, u)
	}
	return mix(p.Gold, p.Pink, u)
}

func travel(lv Choice, u, start, span float64) float64 {
	if lv == New {
		u = 1 - math.Cbrt(1-clamp01(u))
	}
	return start + span*u
}

func wash(lv Choice, d, tail float64) float64 {
	if lv == Advanced {
		if d < 0 {
			return 0
		}
		return clamp01(1 - d/tail)
	}
	return smooth((d+0.1)/0.16) * (1 - smooth((d-0.04)/tail))
}

func wobble(t float64) float64 { return math.Abs(1 - spring(t, 17, 0.34)) }

func reactionCipher(lv Choice, a, b, c int) rune {
	s := "aceosuvwxz·•:;~⠂⠒⠢⠤⠶"
	if lv == Advanced {
		s = "ABCDEFHKMNPRTXZ0123456789#/\\=+<>|[]╳┼"
	}
	r := []rune(s)
	return r[int(noise(a, b, c)*float64(len(r)))]
}

// Caption draws the Ink caption without its four-cell indentation, padded
// to the longer caption so a focus move clears the old ending.
func Caption(r Reaction) string {
	to := []rune(CaptionText(r.Focus))
	from := []rune(CaptionText(r.PrevFocus))
	cv := scene.New(len([]rune(CaptionText(New))), 1)
	p := r.Pal
	cv.Text(0, 0, string(to), p.UI.Muted, 0.5, false)
	if !FocusActive(r) {
		return cv.Row(0, r.NoColor)
	}
	n := max(len(to), len(from))
	p0 := 0
	for p0 < min(len(to), len(from)) && to[p0] == from[p0] {
		p0++
	}
	span := float64(max(n-1-p0, 1))
	age := float64(r.FocusAge) / FPS
	lv := r.Focus
	hold, tail, rate, start, lock0, duration, jitter := 0.2, 0.2, 12.0, 0.16, 0.07, 0.42, 0.05
	if lv == Advanced {
		hold, tail, rate, start, lock0, duration, jitter = 0.13, 0.08, 24, 0.08, 0.05, 0.3, 0.025
	}
	at := func(s []rune, j int) rune {
		if j >= len(s) {
			return ' '
		}
		return s[j]
	}
	for j := p0; j < n; j++ {
		a, b := at(from, j), at(to, j)
		pos := float64(j-p0) / span
		lock := travel(lv, pos, lock0, duration) + jitter*noise(j, 7, 41)
		begin := math.Max(start*pos, lock-hold-0.04*noise(j, 8, 43))
		switch {
		case age < begin:
			cv.Put(j, 0, a, p.UI.Muted, 0.5)
		case age < lock:
			k := fl(age*rate + 3*noise(j, 9, 47))
			n0 := noise(j, k, 59)
			hot := clamp01((age - begin) / math.Max(lock-begin, 0.001))
			col := p.UI.Muted
			if n0 < 0.45 {
				col = reactionTone(p, lv, n0/0.45)
			}
			cv.Put(j, 0, reactionCipher(lv, j, k, 61), p.tint(col, 0.5+0.4*hot), 0.3+0.15*hot)
		default:
			d := age - lock
			if b == ' ' {
				cv.Blank(j, 0)
				if d < 1.0/FPS {
					cv.Put(j, 0, '·', p.Fade(p.UI.Muted, 0.5), 0.3)
				}
			} else if d < 1.0/FPS {
				cv.PutBold(j, 0, b, p.Glow(reactionTone(p, lv, pos), 0.7), 1, true)
			} else if k := quant(1-(d-1.0/FPS)/tail, 6); k > 0 {
				cv.Put(j, 0, b, mix(p.UI.Muted, reactionTone(p, lv, pos), 0.8*k), 0.5+0.2*k)
			}
		}
	}
	return cv.Row(0, r.NoColor)
}

// Label draws a choice's label; the caller supplies its unchanged copy.
// It takes a focus sweep and inks outward from the mark on selection.
func Label(choice Choice, text string, r Reaction) string {
	chars := []rune(text)
	cv := scene.New(len(chars), 1)
	p := r.Pal
	swept := FocusActive(r) && choice == r.Focus
	inked := SelectionActive(r) && choice == r.Selected
	drained := SelectionActive(r) && choice == r.PrevSelected
	for j, ch0 := range chars {
		pos := float64(j) / float64(max(len(chars)-1, 1))
		ch := ch0
		sel := 0.0
		if choice == r.Selected {
			sel = 1
		}
		flash := 0.0
		flashCol := p.UI.Bright
		if inked {
			lv, age := r.Selected, float64(r.SelectAge)/FPS
			start, span := 0.09, 0.32
			if lv == Advanced {
				start, span = 0.05, 0.2
			}
			d := age - travel(lv, pos, start, span)
			if d < 0 {
				sel = 0
			} else if lv == Advanced {
				if d < 1.0/FPS && noise(j, 5, 1) < 0.55 && ch != ' ' {
					ch = reactionCipher(lv, j, 5, 0)
				}
				flash = quant(1-d/0.16, 6)
				glow := 0.0
				if d < 1.0/FPS {
					glow = 0.6
				}
				flashCol = p.Glow(reactionTone(p, lv, pos), glow)
			} else {
				flash = quant(math.Exp(-d/0.14)*(1-smooth((d-0.12)/0.16)), 8)
				flashCol = p.Glow(reactionTone(p, lv, pos), 0.4)
			}
		}
		if drained {
			span := 0.18
			if r.Selected == Advanced {
				span = 0.1
			}
			sel = 1 - quant(smooth(float64(r.SelectAge)/FPS/span), 4)
		}
		col, lum, bold := mix(p.UI.Text, p.UI.Bright, sel), 0.6+0.4*sel, sel >= 0.5
		if flash > 0 {
			col, lum, bold = mix(col, flashCol, flash), math.Max(lum, 0.8+0.2*flash), true
		}
		if swept {
			lv, age := r.Focus, float64(r.FocusAge)/FPS
			span, tail := 0.4, 0.3
			if lv == Advanced {
				span, tail = 0.28, 0.2
			}
			d := age - travel(lv, pos, 0.02, span)
			k := quant(wash(lv, d, tail), 8)
			if k > 0 {
				head := 0.0
				if lv == Advanced && d >= 0 && d < 1.0/FPS {
					head = 0.55
				}
				col = p.Glow(mix(col, reactionTone(p, lv, pos), 0.9*k), head)
				lum, bold = math.Max(lum, 0.6+0.4*k), bold || head > 0
			}
		}
		cv.PutBold(j, 0, ch, col, lum, bold)
	}
	return cv.Row(0, r.NoColor)
}

// Mark draws the one-cell radio mark, morphing on selection and reversing
// the morph on the previously selected choice.
func Mark(choice Choice, r Reaction) string {
	p := r.Pal
	ch, col, lum, bold := '○', p.UI.Muted, 0.6, false
	if choice == r.Selected {
		ch, col, lum, bold = '●', p.UI.AccentText, 1, true
	}
	if SelectionActive(r) {
		age := float64(r.SelectAge) / FPS
		lv := r.Selected
		beat := 0.05
		if lv == Advanced {
			beat = 1.0 / FPS
		}
		if choice == r.PrevSelected && age < 2*beat {
			ch, col = '◎', mix(p.UI.AccentText, p.UI.Muted, 0.7)
			if age < beat {
				ch, col = '◉', mix(p.UI.AccentText, p.UI.Muted, 0.35)
			}
		}
		if choice == lv {
			switch {
			case age < beat:
				ch = '◎'
			case age < 2*beat:
				ch = '◉'
			case lv == New && age >= 0.2 && age < 0.26:
				ch = '◉'
			}
			if lv == Advanced {
				glow := 0.0
				if age < 3.0/FPS {
					glow = 0.6
				}
				col = mix(p.UI.AccentText, p.Glow(p.Cyan, glow), quant(1-(age-2.0/FPS)/0.18, 6))
			} else {
				k := quant(wobble(age-0.1)*(1-smooth((age-0.3)/0.3)), 8)
				if age < 0.1 {
					k = 1
				}
				col = mix(p.UI.AccentText, p.Glow(p.Gold, 0.45), k)
			}
		}
	}
	cv := scene.New(1, 1)
	cv.PutBold(0, 0, ch, col, lum, bold)
	return cv.Row(0, r.NoColor)
}

// Title draws Welcome's unchanged title with one quiet focus glint.
func Title(text string, r Reaction) string {
	chars := []rune(text)
	cv := scene.New(len(chars), 1)
	p := r.Pal
	for j, ch := range chars {
		col := p.UI.AccentText
		if FocusActive(r) {
			age, lv := float64(r.FocusAge)/FPS, r.Focus
			pos := float64(j) / float64(max(len(chars)-1, 1))
			start, span, tail := 0.1, 0.34, 0.28
			if lv == Advanced {
				start, span, tail = 0.08, 0.24, 0.2
			}
			d := age - travel(lv, pos, start, span)
			base := 0.22 * math.Sin(math.Pi*clamp01(age/0.8))
			k := quant(math.Max(0.65*wash(lv, d, tail), base), 8)
			glow := 0.0
			if lv == Advanced && d >= 0 && d < 1.0/FPS {
				glow = 0.4
			}
			col = p.Glow(mix(col, reactionTone(p, lv, pos), k), glow)
		}
		cv.PutBold(j, 0, ch, col, 1, true)
	}
	return cv.Row(0, r.NoColor)
}

// ReactionEmblem draws Welcome's 11×4 Logo with its one-shot Ink pass;
// outside the reaction it is byte-identical to Emblem.
func ReactionEmblem(r Reaction) []string {
	if !FocusActive(r) {
		return Emblem(r.Levels, r.Pal, r.NoColor)
	}
	p, lv, age := r.Pal, r.Focus, float64(r.FocusAge)/FPS
	w, h := ScaleEmblem.Size()
	cv := scene.New(w, h)
	drawRest(cv, p, ScaleEmblem, 0, 0, r.Levels, r.NoColor, 1)
	pos := func(x, y int) float64 {
		if lv == Advanced {
			return float64(x) / float64(w-1)
		}
		return 0.6*float64(h-1-y)/float64(h-1) + 0.4*float64(x)/float64(w-1)
	}
	at := func(s float64) float64 {
		if lv == Advanced {
			return 0.03 + 0.26*s
		}
		return 0.04 + 0.4*s
	}
	for _, b := range rack(ScaleEmblem) {
		y := b.py / 2
		for x := range b.w {
			cell := cv.At(x, y)
			s := pos(x, y)
			d := age - at(s)
			warm := reactionTone(p, lv, s)
			if lv == Advanced {
				switch {
				case d < 0 || d >= 0.38:
					continue
				case d < 0.26/float64(w-1):
					cell.R, cell.FG, cell.Lum = '┃', p.Glow(p.Cyan, 0.7), 1
				case d < 0.17:
					if cell.R == '█' {
						cell.R = '│'
					} else {
						cell.R = '─'
					}
					cell.FG = mix(cell.FG, warm, 0.85)
				default:
					k := quant(0.75*(1-(d-0.17)/0.2), 6)
					cell.FG = mix(cell.FG, warm, k)
				}
			} else {
				k := quant(0.8*wash(lv, d, 0.32), 8)
				if d > -0.07 && d < 0.06 {
					if cell.R == '█' {
						cell.R = '⣿'
					} else {
						cell.R = '⠛'
					}
				}
				cell.FG = p.Glow(mix(cell.FG, warm, k), 0.25*k)
			}
			cv.Put(x, y, cell.R, cell.FG, cell.Lum)
		}
		if r.Levels[b.i] == Unlit {
			continue
		}
		x, y := b.ledX, b.ledY
		ch := '●'
		if r.Levels[b.i] == Fail && r.NoColor {
			ch = '×'
		}
		rest := p.level(r.Levels[b.i])
		if lv == Advanced {
			start := 0.31 + 0.045*float64(b.i)
			switch {
			case age < 0.03 || age >= start+0.16:
			case age < start:
				cv.Put(x, y, '·', p.Fade(p.Muted, 0.45), 0.3)
			case age < start+1.0/FPS:
				cv.PutBold(x, y, ch, p.Glow(p.Cyan, 0.8), 1, true)
			default:
				cv.PutBold(x, y, ch, mix(p.Cyan, rest, quant((age-start-1.0/FPS)/0.12, 4)), 1, true)
			}
		} else {
			d := age - at(pos(x, y)) - 0.03
			switch {
			case d < -0.15 || d >= 0.42:
			case d < 0:
				cv.Put(x, y, '·', p.Fade(p.Muted, 0.45), 0.3)
			case d < 0.05:
				cv.PutBold(x, y, '•', p.Glow(p.Gold, 0.4), 0.8, true)
			default:
				k := quant(wobble(d-0.05)*(1-smooth((d-0.2)/0.22)), 8)
				cv.PutBold(x, y, ch, mix(rest, p.Glow(p.Gold, 0.5), k), 1, true)
			}
		}
	}
	return cv.Lines(r.NoColor)
}
