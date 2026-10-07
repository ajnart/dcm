// Package events is the single way the binary reports progress. Every
// renderer goes through Logger, which redacts registered secret values.
package events

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
)

const (
	RunStart     = "run.start"
	RunEnd       = "run.end"
	StepStart    = "step.start"
	StepOK       = "step.ok"
	StepSkip     = "step.skip"
	StepWarn     = "step.warn"
	StepFail     = "step.fail"
	Command      = "command"
	Info         = "info"
	PullProgress = "pull.progress"
)

type Event struct {
	Event      string `json:"event"`
	App        string `json:"app,omitempty"`
	Step       string `json:"step,omitempty"`
	Msg        string `json:"msg,omitempty"`
	Error      string `json:"error,omitempty"`
	URL        string `json:"url,omitempty"`
	Credential string `json:"credential,omitempty"`
	Hint       string `json:"hint,omitempty"`
	Docs       string `json:"docs,omitempty"`
	Command    string `json:"command,omitempty"`
	Image      string `json:"image,omitempty"`
	Layer      string `json:"layer,omitempty"`
	Status     string `json:"status,omitempty"`
	Current    int64  `json:"current,omitempty"`
	Total      int64  `json:"total,omitempty"`
}

type Sink interface{ Emit(Event) }

type SinkFunc func(Event)

func (f SinkFunc) Emit(e Event) { f(e) }

type Logger struct {
	mu      sync.Mutex
	sinks   []Sink
	secrets []string
}

func New(sinks ...Sink) *Logger { return &Logger{sinks: sinks} }

// Discard is a Logger with no sinks.
func Discard() *Logger { return New() }

func (l *Logger) AddSink(s Sink) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sinks = append(l.sinks, s)
}

// Secret registers a value that must never leave the process through events.
func (l *Logger) Secret(values ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, v := range values {
		if len(v) >= 4 {
			l.secrets = append(l.secrets, v)
		}
	}
}

func (l *Logger) redact(s string) string {
	for _, secret := range l.secrets {
		s = strings.ReplaceAll(s, secret, "[redacted]")
	}
	return s
}

func (l *Logger) Emit(e Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, field := range []*string{&e.Msg, &e.Error, &e.URL, &e.Hint, &e.Command} {
		*field = l.redact(*field)
	}
	for _, sink := range l.sinks {
		sink.Emit(e)
	}
}

// JSON writes one event per line.
func JSON(w io.Writer) Sink {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return SinkFunc(func(e Event) { enc.Encode(e) })
}

// Human writes readable lines. Verbose adds commands and step starts. On a
// terminal pull progress is redrawn in place; otherwise only the final line
// per image is printed.
func Human(w io.Writer, verbose, interactive bool) Sink {
	var lastWidth int
	return SinkFunc(func(e Event) {
		if e.Event == PullProgress {
			if e.Status == "Pulled" {
				if interactive {
					fmt.Fprintf(w, "\r%s\r", strings.Repeat(" ", lastWidth))
					lastWidth = 0
				}
				fmt.Fprintf(w, "✓ pulled %s\n", e.Image)
				return
			}
			if !interactive || e.Total <= 0 {
				return
			}
			pct := int(e.Current * 100 / e.Total)
			if pct > 100 {
				pct = 100
			}
			line := fmt.Sprintf("pulling %s  %s %d%%  %s / %s", e.Image, pullBar(pct), pct, formatBytes(e.Current), formatBytes(e.Total))
			if len(line) < lastWidth {
				line += strings.Repeat(" ", lastWidth-len(line))
			}
			lastWidth = len(line)
			fmt.Fprintf(w, "\r%s", line)
			return
		}
		subject := e.Step
		if e.App != "" && e.Step != "" {
			subject = e.App + " › " + e.Step
		} else if e.App != "" {
			subject = e.App
		}
		switch e.Event {
		case RunStart:
			fmt.Fprintf(w, "▶ %s\n", e.Msg)
		case RunEnd:
			if e.Error != "" {
				fmt.Fprintf(w, "✗ %s\n", e.Error)
			} else {
				fmt.Fprintf(w, "■ %s\n", e.Msg)
			}
		case StepStart:
			if verbose {
				fmt.Fprintf(w, "  … %s %s\n", subject, e.Msg)
			}
		case StepOK:
			fmt.Fprintf(w, "  ✓ %s %s\n", subject, e.Msg)
		case StepSkip:
			fmt.Fprintf(w, "  ↷ %s %s\n", subject, e.Msg)
		case StepWarn:
			fmt.Fprintf(w, "  ! %s %s\n", subject, e.Msg)
		case StepFail:
			fmt.Fprintf(w, "  ✗ %s %s\n", subject, e.Msg)
			if e.Error != "" {
				fmt.Fprintf(w, "      error: %s\n", e.Error)
			}
			if e.URL != "" {
				fmt.Fprintf(w, "      url: %s\n", e.URL)
			}
			if e.Credential != "" {
				fmt.Fprintf(w, "      credential: %s (self-host credentials)\n", e.Credential)
			}
		case Command:
			if verbose {
				fmt.Fprintf(w, "    $ %s\n", e.Command)
			}
		default:
			fmt.Fprintf(w, "  %s\n", e.Msg)
		}
		if e.Event == StepWarn || e.Event == StepFail {
			if e.Hint != "" {
				fmt.Fprintf(w, "      → %s\n", e.Hint)
			}
			if e.Docs != "" {
				fmt.Fprintf(w, "      docs: %s\n", e.Docs)
			}
		}
	})
}

// pullBar is a ten-cell bar for a percentage.
func pullBar(pct int) string {
	filled := min(pct/10, 10)
	return "▕" + strings.Repeat("█", filled) + strings.Repeat("░", 10-filled) + "▏"
}

// formatBytes renders a byte count in decimal units, like Docker does.
func formatBytes(n int64) string {
	switch {
	case n >= 1_000_000_000:
		return fmt.Sprintf("%.1f GB", float64(n)/1_000_000_000)
	case n >= 1_000_000:
		return fmt.Sprintf("%d MB", n/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%d KB", n/1_000)
	default:
		return fmt.Sprintf("%d B", n)
	}
}
