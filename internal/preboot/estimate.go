package preboot

import "time"

// rotateFrames is how long a comparison stays before the next one of its
// bucket takes over.
const rotateFrames = 10 * FPS

// bucket is a range of time remaining and the things it is compared to.
type bucket struct {
	// under is the bucket's upper bound; the last bucket has none.
	under time.Duration
	// typical stands for the bucket when a Pace reports it.
	typical time.Duration
	lines   []string
}

var buckets = []bucket{
	{30 * time.Second, 15 * time.Second, []string{
		"a deep breath", "a good stretch", "tying your shoelaces"}},
	{2 * time.Minute, time.Minute, []string{
		"a song on the radio", "the kettle coming to the boil", "a quick tidy of your desk"}},
	{5 * time.Minute, 3 * time.Minute, []string{
		"brewing a pot of tea", "folding a basket of laundry", "watering every plant in the house"}},
	{15 * time.Minute, 8 * time.Minute, []string{
		"a walk around the block", "cooking a pot of pasta", "a long chat with an old friend"}},
	{0, 25 * time.Minute, []string{
		"an episode of your favourite show", "a long, lazy bath", "baking a loaf of bread"}},
}

var warmingUp = []string{"Warming up the engines…", "Measuring the distance to your Apps…"}

func bucketOf(remaining time.Duration) int {
	for i, b := range buckets[:len(buckets)-1] {
		if remaining < b.under {
			return i
		}
	}
	return len(buckets) - 1
}

// timeLine is the sentence under the title: a lead and what follows it.
type timeLine struct{ lead, body string }

func (l timeLine) String() string { return l.lead + l.body }

// timeLines are the ways to say how long is left, longest first. Before there
// is an estimate (remaining is 0) it is a warming-up line. Within a bucket the
// comparison changes every rotateFrames.
func timeLines(remaining time.Duration, n int) []timeLine {
	turn := n / rotateFrames
	if remaining <= 0 {
		return []timeLine{{body: warmingUp[turn%len(warmingUp)]}}
	}
	lines := buckets[bucketOf(remaining)].lines
	what := lines[turn%len(lines)] + "."
	return []timeLine{{"This should take about as long as ", what}, {"About as long as ", what}}
}

// Pace turns how long the pull has run and how much of it is done into a
// steady estimate of the time left. It holds a bucket and only moves to
// another once the estimate has stayed in it for a few seconds, so the line
// the screen shows does not flicker between two comparisons. The zero value
// has no estimate yet.
type Pace struct {
	known     bool
	shown     int
	candidate int
	since     int
}

const (
	// minFraction and minElapsed are how much of the pull must be seen
	// before a guess is worth showing.
	minFraction = 0.05
	minElapsed  = 3 * time.Second
	// holdFrames is how long a new bucket must hold before it is shown.
	holdFrames = 4 * FPS
)

// Observe takes the frame the screen has reached, counted from when the pull
// began, and the pull's fraction.
func (p *Pace) Observe(frame int, fraction float64) {
	elapsed := time.Duration(frame) * time.Second / FPS
	if fraction < minFraction || elapsed < minElapsed {
		return
	}
	left := time.Duration(float64(elapsed) * (1 - min(fraction, 1)) / fraction)
	b := bucketOf(left)
	switch {
	case !p.known:
		p.known, p.shown, p.candidate = true, b, b
	case b == p.shown:
		p.candidate = b
	case b != p.candidate:
		p.candidate, p.since = b, frame
	case frame-p.since >= holdFrames:
		p.shown = b
	}
}

// Remaining is the estimate for Progress: the typical time of the bucket
// being shown, or 0 while there is none.
func (p *Pace) Remaining() time.Duration {
	if !p.known {
		return 0
	}
	return buckets[p.shown].typical
}
