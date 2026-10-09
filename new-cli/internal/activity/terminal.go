package activity

import (
	"bytes"
	"fmt"
	"io"
	"strings"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

// Terminal is the events sink for an interactive terminal. It prints every
// event as events.Human does and redraws the pull block in place below those
// lines while a pull runs; when the pull ends its final block stays.
func Terminal(w io.Writer, verbose bool, width int, p Palette) events.Sink {
	t := &terminal{w: w, width: width, palette: p}
	t.human = events.Human(&t.buf, verbose)
	return t
}

type terminal struct {
	w       io.Writer
	width   int
	palette Palette
	human   events.Sink
	buf     bytes.Buffer
	evs     []events.Event
	// drawn is the number of lines of the block on screen that the next
	// redraw replaces.
	drawn int
}

func (t *terminal) Emit(e events.Event) {
	t.evs = append(t.evs, e)
	s := Build(service.Status{}, t.evs)
	block := Render(s, t.width, t.palette)
	if t.drawn > 0 && len(block) == 0 {
		t.drawn = 0
	}
	if t.drawn > 0 {
		fmt.Fprintf(&t.buf, "\r\x1b[%dA\x1b[J", t.drawn)
		t.drawn = 0
		if !s.Pull.Pulling {
			t.writeBlock(block)
		}
	}
	if e.Event != events.PullProgress {
		t.human.Emit(e)
	}
	if s.Pull.Pulling && len(block) > 0 {
		t.writeBlock(block)
		t.drawn = len(block)
	}
	t.w.Write(t.buf.Bytes())
	t.buf.Reset()
}

func (t *terminal) writeBlock(block []string) {
	t.buf.WriteString(strings.Join(block, "\n") + "\n")
}
