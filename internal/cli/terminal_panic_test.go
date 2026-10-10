package cli

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/activity"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

type terminalPanicWriter struct{}

func (terminalPanicWriter) Write([]byte) (int, error) {
	panic("synthetic-terminal-secret /home/alice")
}

func TestSynchronousTerminalPanicFlushesBeforeCrash(t *testing.T) {
	for _, callback := range []string{"width", "writer"} {
		t.Run(callback, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "payload.json")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSynchronousTerminalPanicChild$", "--", callback, file)
			cmd.Env = []string{"SELF_HOST_TERMINAL_PANIC_CHILD=1"}
			out, err := cmd.CombinedOutput()
			if err == nil || ctx.Err() != nil {
				t.Fatalf("original panic did not crash promptly: %v\n%s", err, out)
			}
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatalf("exception not flushed: %v\n%s", err, out)
			}
			var sent []map[string]any
			if err := json.Unmarshal(data, &sent); err != nil {
				t.Fatal(err)
			}
			var original bool
			for _, event := range sent {
				if event["event"] != "$exception" {
					continue
				}
				props := event["properties"].(map[string]any)
				item := props["$exception_list"].([]any)[0].(map[string]any)
				if item["value"] != "panic" || item["mechanism"].(map[string]any)["handled"] != false {
					t.Fatalf("not a safe unhandled panic: %v", item)
				}
				for _, frame := range item["stacktrace"].(map[string]any)["frames"].([]any) {
					if frame.(map[string]any)["function"] == "internal/activity.(*TerminalSink).Emit" {
						original = true
					}
				}
			}
			if !original || strings.Contains(string(data), "synthetic-terminal-secret") || strings.Contains(string(data), "/home/alice") {
				t.Fatalf("original safe Emit stack missing: %s", data)
			}
			if !strings.Contains(string(out), "synthetic-terminal-secret /home/alice") {
				t.Fatalf("original panic masked: %s", out)
			}
		})
	}
}

func TestSynchronousTerminalPanicChild(t *testing.T) {
	if os.Getenv("SELF_HOST_TERMINAL_PANIC_CHILD") != "1" {
		return
	}
	telemetry.ProjectKey = "phc_test"
	deps := systemtest.NewDeps(t)
	deps.Version, deps.Interactive = "1.2.3", true
	net := &telemetrytest.Transport{}
	deps.HTTP = net.Client()
	cat := catalog.New(nil, nil)
	a := &program{deps: deps, catalog: cat, args: []string{"doctor"}, steps: telemetry.Progress{Now: deps.Now}}
	callback := os.Args[len(os.Args)-2]
	width := func() int { panic("synthetic-terminal-secret /home/alice") }
	var writer io.Writer = io.Discard
	if callback == "writer" {
		width = func() int { return 80 }
		writer = terminalPanicWriter{}
	}
	a.terminal = activity.Terminal(writer, true, width, activity.Simple, activity.Palette{})
	a.log = events.New(a.terminal)
	defer func() {
		if crash := recover(); crash != nil {
			data, err := json.Marshal(net.Events())
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(os.Args[len(os.Args)-1], data, 0o600); err != nil {
				t.Fatal(err)
			}
			panic(crash)
		}
	}()
	a.run(context.Background())
}
