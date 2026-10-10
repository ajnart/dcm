package activity

import (
	"bytes"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
)

// tickSource starts a frame source and returns its channel and a stop
// function. Tests inject their own.
type tickSource func() (<-chan time.Time, func())

func realTicks() (<-chan time.Time, func()) {
	t := time.NewTicker(time.Second / FPS)
	return t.C, t.Stop
}

// TerminalSink is the events sink for an interactive terminal. It prints
// every event as events.Human does, as a permanent log, and below it redraws
// the running Action in place at about 12 frames per second. When the Action
// ends its final block stays. Width is read for every redraw, so the block
// follows a resized terminal.
type TerminalSink struct {
	w       io.Writer
	width   func() int
	glyphs  Glyphs
	palette Palette
	human   events.Sink
	ticks   tickSource

	mu      sync.Mutex
	buf     bytes.Buffer
	evs     []events.Event
	tracker Tracker
	frame   int
	// shown is the block on screen that the next redraw replaces.
	shown []string
	// stop ends the ticker goroutine; done is closed once it returned.
	stop chan struct{}
	done chan struct{}
	// drawn, when set, is called after each tick is drawn, without the lock
	// held. It lets a test wait for a frame; it must not block.
	drawn  func()
	crash  *system.CapturedPanic
	failed bool
}

func Terminal(w io.Writer, verbose bool, width func() int, g Glyphs, p Palette) *TerminalSink {
	return newTerminal(w, verbose, width, g, p, realTicks)
}

func newTerminal(w io.Writer, verbose bool, width func() int, g Glyphs, p Palette, ticks tickSource) *TerminalSink {
	t := &TerminalSink{w: w, width: width, glyphs: g, palette: p, ticks: ticks}
	t.human = events.Human(&t.buf, verbose)
	return t
}

func (t *TerminalSink) Emit(e events.Event) {
	if wait := t.emit(e); wait != nil {
		wait()
	}
}

func (t *TerminalSink) emit(e events.Event) (wait func()) {
	t.mu.Lock()
	completed := false
	defer func() {
		if !completed {
			t.failed = true
		}
		t.mu.Unlock()
	}()
	if e.Event == events.RunStart {
		t.evs = t.evs[:0]
		t.shown = nil
	}
	t.evs = append(t.evs, e)
	s := Build(service.Status{}, t.evs)
	t.tracker.Observe(s, t.frame)
	if e.Event == events.PullProgress {
		t.redraw(s, t.tracker.Motion(t.frame))
		t.flush()
		completed = true
		return nil
	}
	t.erase()
	t.human.Emit(e)
	if e.Event == events.RunEnd {
		// The final block is drawn at rest and left on screen.
		t.redraw(s, Motion{Frame: t.frame})
		t.shown = nil
		wait = t.stopTicker()
	} else {
		if e.Event == events.RunStart {
			t.startTicker()
		}
		t.redraw(s, t.tracker.Motion(t.frame))
	}
	t.flush()
	completed = true
	return wait
}

// Close stops the frame ticker; the block on screen stays.
func (t *TerminalSink) Close() {
	t.mu.Lock()
	wait := t.stopTicker()
	t.mu.Unlock()
	wait()
}

func (t *TerminalSink) tick() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stop == nil || t.failed {
		return
	}
	t.frame++
	s := Build(service.Status{}, t.evs)
	t.tracker.Observe(s, t.frame)
	t.redraw(s, t.tracker.Motion(t.frame))
	t.flush()
}

func (t *TerminalSink) startTicker() {
	if t.stop != nil {
		return
	}
	ticks, stopTicks := t.ticks()
	stop, done := make(chan struct{}), make(chan struct{})
	t.stop, t.done = stop, done
	go func() {
		defer close(done)
		defer stopTicks()
		crash := system.CatchPanic(func() {
			for {
				select {
				case <-stop:
					return
				case <-ticks:
					t.tick()
					if t.drawn != nil {
						t.drawn()
					}
				}
			}
		})
		t.mu.Lock()
		t.crash = crash
		t.mu.Unlock()
	}()
}

// stopTicker asks the ticker to stop and returns a function that waits for
// it, to call without holding the lock.
func (t *TerminalSink) stopTicker() func() {
	if t.stop == nil {
		return func() {}
	}
	close(t.stop)
	done := t.done
	t.stop, t.done = nil, nil
	return func() {
		<-done
		t.mu.Lock()
		crash := t.crash
		t.crash = nil
		t.mu.Unlock()
		if crash != nil {
			panic(*crash)
		}
	}
}

// redraw replaces the block on screen with the Action's block, unless it
// is unchanged. An Action with nothing to draw yet has no block.
func (t *TerminalSink) redraw(s Snapshot, m Motion) {
	var block []string
	if len(s.Action.Stages) > 0 || s.Pull.Pulling {
		block = Render(s, m, t.width(), t.glyphs, t.palette)
	}
	if slices.Equal(block, t.shown) {
		return
	}
	t.erase()
	if len(block) > 0 {
		t.buf.WriteString(strings.Join(block, "\n") + "\n")
	}
	t.shown = block
}

func (t *TerminalSink) erase() {
	if len(t.shown) > 0 {
		fmt.Fprintf(&t.buf, "\r\x1b[%dA\x1b[J", len(t.shown))
		t.shown = nil
	}
}

func (t *TerminalSink) flush() {
	if t.buf.Len() > 0 {
		t.w.Write(t.buf.Bytes())
		t.buf.Reset()
	}
}
