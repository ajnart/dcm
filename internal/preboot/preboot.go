// Package preboot draws the pre-boot screen: the full-screen scene shown
// while the first install pulls its images. It is a parallax starfield, with
// aurora ribbons, shooting stars and sparkles around the Logo, the pull's
// bar and a friendly line on how long is left. Its exit stretches the stars
// into streaks and then wipes the Dashboard in along a slanted edge.
//
// Rendering is pure: a frame is a function of the frame number, the size,
// the Progress, the palette and whether colour is off. The package keeps no
// clock; the caller counts frames at FPS.
package preboot

import (
	"math"
	"time"
)

const (
	// FPS is the frame rate of the pre-boot screen.
	FPS            = 24
	EntranceFrames = 12
	// ExitFrames is how many frames the exit plays.
	ExitFrames = 44

	streakFrames = 24
	wipeFrom     = 20
)

// Progress is what the screen shows of the pull.
type Progress struct {
	// Fraction is the overall pull, from 0 to 1.
	Fraction    float64
	Done, Total int
	Narrative   string
	// Remaining is the estimated time left, 0 while there is no estimate;
	// the screen then says it is warming up. A Pace makes a steady one.
	Remaining time.Duration
}

type frame struct {
	n, w, h int
	pr      Progress
	pal     Palette
	noColor bool
	// since counts frames since the exit began, -1 while pulling.
	since int
	lay   layout
	text  block
}

type tier int

const (
	small tier = iota
	medium
	full
)

type layout struct {
	tier                tier
	cx, brandCY, brandR int
	titleY, timeY       int
	keysY, barY, narrY  int
	barW                int
}

func layoutFor(w, h int) layout {
	cx := w / 2
	switch {
	case w >= 100 && h >= 28:
		t := max((h-19)/2, 0)
		return layout{tier: full, cx: cx, brandCY: t + 3, brandR: 3, titleY: t + 8, timeY: t + 11,
			keysY: t + 13, barY: t + 16, narrY: t + 18, barW: min(52, w-34)}
	case w >= 80 && h >= 24:
		t := max((h-15)/2, 0)
		return layout{tier: medium, cx: cx, brandCY: t + 2, brandR: 2, titleY: t + 6, timeY: t + 8,
			keysY: t + 10, barY: t + 12, narrY: t + 14, barW: min(40, w-30)}
	}
	t := max((h-8)/2, 0)
	return layout{tier: small, cx: cx, titleY: t, timeY: t + 2, keysY: t + 4, barY: t + 6, narrY: t + 7,
		barW: max(min(28, w-24), 8)}
}

func newFrame(n, since, w, h int, pr Progress, pal Palette, noColor bool) *frame {
	f := &frame{n: n, w: w, h: h, pr: pr, pal: pal, noColor: noColor, since: since, lay: layoutFor(w, h)}
	f.text = f.layoutText()
	return f
}

func (f *frame) t() float64 { return float64(f.n) / FPS }

// te is the seconds since the exit began.
func (f *frame) te() float64 {
	if f.since < 0 {
		return 0
	}
	return float64(f.since) / FPS
}

// warp is how far the stars have stretched into streaks, 0 while pulling.
func (f *frame) warp() float64 {
	if f.since < 0 {
		return 0
	}
	return smooth(float64(f.since) / streakFrames)
}

// fade is the opacity of the text while exiting.
func (f *frame) fade() float64 {
	if f.since < 0 {
		return 1
	}
	return 1 - clamp01(float64(f.since)/8)
}

// opening is how far the wipe has gone, 0 until the streaks are long.
func (f *frame) opening() float64 {
	if f.since < wipeFrom {
		return 0
	}
	return clamp01(float64(f.since-wipeFrom) / float64(ExitFrames-1-wipeFrom))
}

func (f *frame) scene() *canvas {
	return f.entranceScene(1)
}

func (f *frame) entranceScene(amount float64) *canvas {
	cv := newCanvas(f.w, f.h)
	f.sky(cv)
	cv.Flush()
	if f.lay.tier != small {
		f.brand(cv)
	}
	if amount < 1 {
		for i, c := range cv.Cells {
			x, y := i%f.w, i/f.w
			distance := math.Max(float64(abs(x-f.lay.cx))/float64(max(f.w/2, 1)), float64(abs(y-f.lay.brandCY))/float64(max(f.h, 1)))
			if distance > amount {
				cv.Cells[i] = cell{}
				continue
			}
			c.FG, c.Lum = f.pal.Fade(c.FG, amount), c.Lum*amount
			cv.Cells[i] = c
		}
	}
	f.drawText(cv)
	cv.Flush()
	return cv
}

// Render draws frame n of the pull in a width×height terminal.
func Render(n, width, height int, pr Progress, pal Palette, noColor bool) []string {
	return newFrame(n, -1, width, height, pr, pal, noColor).scene().Lines(noColor)
}

func RenderEntrance(n, width, height int, pr Progress, pal Palette, noColor bool) []string {
	amount := 1 - math.Pow(1-clamp01(float64(n)/EntranceFrames), 3)
	return newFrame(n, -1, width, height, pr, pal, noColor).entranceScene(amount).Lines(noColor)
}

// RenderExit draws frame since of the exit, n frames after the pull began:
// the stars stretch into streaks, then a slanted wipe brings in under, the
// screen the person lands on, one string per row.
func RenderExit(n, since, width, height int, pr Progress, pal Palette, noColor bool, under []string) []string {
	f := newFrame(n, since, width, height, pr, pal, noColor)
	cv := f.scene()
	if opening := f.opening(); opening > 0 {
		return f.reveal(cv.Lines(noColor), under, opening)
	}
	return cv.Lines(noColor)
}
