package intro

const (
	// FPS is the frame rate of the Intro and of Welcome's reactions.
	FPS = 24
	// SceneFrames is the length of the choreography: 3.5 s.
	SceneFrames = 84
	// ExitFrames is the length of the exit into Welcome: 0.75 s.
	ExitFrames = 18
	// BeatFrames is the gap between two checks ticking into the Doctor line.
	BeatFrames = 6
	// TickFromFrame is the earliest frame, counted from the Intro opening,
	// at which the first check may tick into the line: 0.8 s.
	TickFromFrame = 20
	// CardFrames is how long a card takes to fall away; the caller drops it
	// from the Hold after that.
	CardFrames = 6
	// RecoverFrames is how long the dimming takes to lift after a passing
	// check: 0.45 s.
	RecoverFrames = 11
	// FocusFrames is how long the reaction to a focus move plays.
	FocusFrames = 22
	// SelectFrames is how long the reaction to a selection plays.
	SelectFrames = 18
)

// Check is one Doctor result as the Doctor line and the cards show it.
type Check struct {
	Title, Detail, Hint, Docs string
	// Level is OK, Warn or Fail.
	Level Level
}

// Doctor is what the Intro knows of Doctor.
type Doctor struct {
	Checks []Check
	// Reading is true until Doctor has returned its checks.
	Reading bool
	// Again is true while Reading after a check again.
	Again bool
	// SettingsReading is true while the checks are done but the Host's
	// settings are not.
	SettingsReading bool
	// TickFrom is the Wall frame at which the first check ticks into the
	// line; see TickStart.
	TickFrom int
}

// TickStart is the frame the first check ticks into the line, given the
// frame the checks arrived: no earlier than TickFromFrame, unless the checks
// are being read again or motion is reduced.
func TickStart(arrived int, immediate bool) int {
	if immediate {
		return arrived
	}
	return max(arrived, TickFromFrame)
}

// Settled reports whether the scene clock has reached the settled frame.
func Settled(frame int) bool { return frame >= SceneFrames }

func (d Doctor) litAt(i int) int { return d.TickFrom + i*BeatFrames }

// Ticked is how many checks have ticked into the Doctor line by wall.
func Ticked(wall int, d Doctor) int {
	if d.Reading {
		return 0
	}
	n := 0
	for i := range d.Checks {
		if d.litAt(i) <= wall {
			n++
		}
	}
	return n
}

// Ready reports whether every check has ticked and had its beat and the
// Host's settings are read: the Intro may move on.
func Ready(wall int, d Doctor) bool {
	if d.Reading || len(d.Checks) == 0 || d.SettingsReading {
		return false
	}
	return wall >= d.litAt(len(d.Checks))
}

// Worst is the highest level among the checks.
func Worst(d Doctor) Level {
	w := OK
	for _, c := range d.Checks {
		w = max(w, c.Level)
	}
	return w
}

// Hold is a warning or failure holding the Intro: the card and, for a
// failure, the dimming. Build it with NewHold.
type Hold struct {
	// Level is Warn or Fail; Unlit means no hold.
	Level Level
	// Since is the Wall frame the hold began, Out the frame its card began to
	// fall away and Recover the frame a passing check began to lift the
	// dimming. Out and Recover are negative until then.
	Since, Out, Recover int
}

// NewHold is a hold of the given level that began at wall.
func NewHold(l Level, wall int) Hold { return Hold{Level: l, Since: wall, Out: -1, Recover: -1} }

// Input is everything one Intro frame depends on.
type Input struct {
	W, H int
	// Frame is the scene clock: it counts from 0, jumps to SceneFrames when
	// a key settles the scene, and may stall or slow while a failure holds.
	Frame int
	// Wall counts frames since the Intro opened and never stalls; the
	// Doctor line, the cards and the dimming run on it.
	Wall    int
	Doctor  Doctor
	Hold    Hold
	Pal     Palette
	NoColor bool
	// Reduced draws the settled frame, static.
	Reduced bool
}

func (in Input) tier() tier { return tierFor(in.W, in.H) }

type tier int

const (
	tierSmall tier = iota
	tierMedium
	tierFull
)

func tierFor(w, h int) tier {
	switch {
	case w >= 100 && h >= 28:
		return tierFull
	case w >= 80 && h >= 24:
		return tierMedium
	}
	return tierSmall
}

// Pos is a cell.
type Pos struct{ X, Y int }

// Box is a rectangle of cells.
type Box struct{ X, Y, W, H int }

// Target is where the exit lands: Welcome's first frame.
type Target struct {
	// Lines is Welcome's first frame, H rows of W columns, styled.
	Lines []string
	// Title is Welcome's title text and where it sits.
	Title   string
	TitleAt Pos
	// Emblem is the emblem box, nil when Welcome has no room for it.
	Emblem *Box
	// Chrome lists the rows of the header, step indicator and key bar, which
	// fade in later than the body.
	Chrome []int
}
