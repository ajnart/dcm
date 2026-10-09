// Package preboot draws the pre-boot screen: the full-screen scene shown
// while the first install pulls its images. It is a hyperspace tunnel whose
// star trails lengthen with the pull, with a star lit and named for each
// finished image, and an exit that stretches the stars into streaks and then
// opens a diamond iris onto the Dashboard.
//
// Rendering is pure: a frame is a function of the frame number, the size,
// the Progress, the palette and whether colour is off. The package keeps no
// clock; the caller counts frames at FPS.
package preboot

const (
	// FPS is the frame rate of the pre-boot screen.
	FPS = 24
	// ExitFrames is how many frames the exit plays.
	ExitFrames = 44

	streakFrames = 24
	irisFrom     = 20
)

// Progress is what the screen shows of the pull.
type Progress struct {
	// Fraction is the overall pull, from 0 to 1.
	Fraction    float64
	Done, Total int
	Narrative   string
	// Images are in pull order.
	Images []Image
}

// Image is one image of the pull; a finished one lights its star.
type Image struct {
	Label string
	Done  bool
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
	tier                      tier
	cx, brandCY, brandR       int
	titleY, coffeeY, keysY    int
	barY, narrY, steamY, cupY int
	barW                      int
}

func layoutFor(w, h int) layout {
	cx := w / 2
	switch {
	case w >= 100 && h >= 28:
		t := max((h-21)/2, 0)
		return layout{tier: full, cx: cx, brandCY: t + 3, brandR: 3, titleY: t + 8, steamY: t + 10, coffeeY: t + 11,
			cupY: t + 13, keysY: t + 15, barY: t + 18, narrY: t + 20, barW: min(52, w-34)}
	case w >= 80 && h >= 24:
		t := max((h-15)/2, 0)
		return layout{tier: medium, cx: cx, brandCY: t + 2, brandR: 2, titleY: t + 6, coffeeY: t + 8,
			keysY: t + 10, barY: t + 12, narrY: t + 14, barW: min(40, w-30)}
	}
	t := max((h-7)/2, 0)
	return layout{tier: small, cx: cx, titleY: t, coffeeY: t + 2, keysY: t + 3, barY: t + 5, narrY: t + 6,
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

// opening is how far the iris has opened, 0 until the streaks are long.
func (f *frame) opening() float64 {
	if f.since < irisFrom {
		return 0
	}
	return clamp01(float64(f.since-irisFrom) / float64(ExitFrames-1-irisFrom))
}

// centre is where the tunnel and the iris open from.
func (f *frame) centre() (int, int) {
	if f.lay.tier == small {
		return f.lay.cx, f.h * 2 / 5
	}
	return f.lay.cx, f.lay.brandCY
}

func (f *frame) scene() *canvas {
	cv := newCanvas(f.w, f.h)
	f.tunnel(cv)
	f.imageStars(cv)
	if f.lay.tier != small {
		f.brand(cv)
	}
	f.drawText(cv)
	return cv
}

// Render draws frame n of the pull in a width×height terminal.
func Render(n, width, height int, pr Progress, pal Palette, noColor bool) []string {
	return newFrame(n, -1, width, height, pr, pal, noColor).scene().lines(noColor)
}

// RenderExit draws frame since of the exit, n frames after the pull began:
// the stars stretch into streaks, then a diamond iris opens from the ◆ onto
// under, the screen the person lands on, one string per row.
func RenderExit(n, since, width, height int, pr Progress, pal Palette, noColor bool, under []string) []string {
	f := newFrame(n, since, width, height, pr, pal, noColor)
	cv := f.scene()
	if opening := f.opening(); opening > 0 {
		return f.reveal(cv.lines(noColor), under, opening)
	}
	return cv.lines(noColor)
}
