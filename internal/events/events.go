// Package events is the single way the binary reports progress. Every
// renderer goes through Logger, which redacts registered secret values.
package events

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
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
	StepManual   = "step.manual"
	Command      = "command"
	Info         = "info"
	PullProgress = "pull.progress"
	Log          = "log"
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
		if v != "" {
			l.secrets = append(l.secrets, v)
		}
	}
	sort.SliceStable(l.secrets, func(i, j int) bool { return len(l.secrets[i]) > len(l.secrets[j]) })
}

func (l *Logger) redact(s string) string {
	var replacements []string
	for _, secret := range l.secrets {
		replacements = append(replacements, secret, "[redacted]")
	}
	return strings.NewReplacer(replacements...).Replace(s)
}

// Redact protects diagnostic text outside the event sink, such as saved steps.
func (l *Logger) Redact(s string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.redact(s)
}

type redactedError struct {
	text  string
	cause error
}

func (e redactedError) Error() string { return e.text }
func (e redactedError) Unwrap() error { return e.cause }

// RedactError hides credentials in diagnostics while preserving error identity.
func (l *Logger) RedactError(err error) error {
	if err == nil {
		return nil
	}
	text := l.Redact(err.Error())
	if text == err.Error() {
		return err
	}
	return redactedError{text: text, cause: err}
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

// Human writes readable lines. Verbose adds commands and step starts. Pull
// progress prints only the final line per image.
func Human(w io.Writer, verbose bool) Sink {
	return SinkFunc(func(e Event) {
		if e.Event == PullProgress {
			if e.Status == "Pulled" {
				fmt.Fprintf(w, "✓ pulled %s\n", e.Image)
			}
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
		case StepWarn, StepManual:
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
		if e.Event == StepWarn || e.Event == StepFail || e.Event == StepManual {
			if e.Hint != "" {
				fmt.Fprintf(w, "      → %s\n", e.Hint)
			}
			if e.Docs != "" {
				fmt.Fprintf(w, "      docs: %s\n", e.Docs)
			}
		}
	})
}
