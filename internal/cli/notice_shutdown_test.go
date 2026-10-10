package cli

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

type noticeShutdownResult struct {
	Events   []map[string]any
	Rejected bool
	Accepted bool
}

func noticeShutdownWorker() {
	panic("synthetic-notice-secret /home/alice")
}

func TestCLIErrorRejectsNoticeAndRethrowsReadyWorkerPanic(t *testing.T) {
	for _, mode := range []string{"ready-panic", "normal-offer", "blocked", "primary-panic"} {
		t.Run(mode, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "payload.json")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCLIErrorNoticeChild$", "--", mode, file)
			cmd.Env = []string{"SELF_HOST_ERROR_NOTICE_CHILD=1"}
			out, err := cmd.CombinedOutput()
			if err == nil || ctx.Err() != nil {
				t.Fatalf("child did not exit promptly with failure: %v\n%s", err, out)
			}
			data, err := os.ReadFile(file)
			if err != nil {
				t.Fatalf("no shutdown result: %v\n%s", err, out)
			}
			var result noticeShutdownResult
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatal(err)
			}
			if !result.Rejected || result.Accepted {
				t.Fatalf("unused notice was not rejected: %s", data)
			}
			var exception map[string]any
			for _, e := range result.Events {
				if e["event"] == "$exception" {
					exception = e["properties"].(map[string]any)
				}
			}
			if mode == "normal-offer" || mode == "blocked" {
				if exception != nil && exception["$exception_list"].([]any)[0].(map[string]any)["mechanism"].(map[string]any)["handled"] != true {
					t.Fatalf("ordinary error became an exception: %s", data)
				}
				return
			}
			if exception == nil {
				t.Fatalf("ready panic was discarded: %s", data)
			}
			item := exception["$exception_list"].([]any)[0].(map[string]any)
			if item["value"] != "panic" || item["mechanism"].(map[string]any)["handled"] != false {
				t.Fatalf("not a safe unhandled exception: %v", item)
			}
			var workerFrame bool
			for _, frame := range item["stacktrace"].(map[string]any)["frames"].([]any) {
				if frame.(map[string]any)["function"] == "internal/cli.noticeShutdownWorker" {
					workerFrame = true
				}
			}
			if mode == "ready-panic" && (!workerFrame || !strings.Contains(string(out), "synthetic-notice-secret /home/alice")) {
				t.Fatalf("original worker panic was lost: %s\n%s", data, out)
			}
			if mode == "primary-panic" && (workerFrame || !strings.Contains(string(out), "synthetic-primary-secret /home/alice")) {
				t.Fatalf("primary panic was masked by cleanup: %s\n%s", data, out)
			}
			if strings.Contains(string(data), "synthetic-notice-secret") || strings.Contains(string(data), "synthetic-primary-secret") || strings.Contains(string(data), "/home/alice") {
				t.Fatalf("exception leaked panic text: %s", data)
			}
		})
	}
}

func TestCLIErrorNoticeChild(t *testing.T) {
	if os.Getenv("SELF_HOST_ERROR_NOTICE_CHILD") != "1" {
		return
	}
	mode := os.Args[len(os.Args)-2]
	telemetry.ProjectKey = "phc_test"
	deps := systemtest.NewDeps(t)
	deps.Version, deps.Interactive = "1.2.3", true
	net := &telemetrytest.Transport{}
	deps.HTTP = net.Client()
	cat := catalog.New(nil, nil)
	a := &program{deps: deps, catalog: cat, args: []string{"apps", "info", "missing"}, steps: telemetry.Progress{Now: deps.Now}}
	if mode == "primary-panic" {
		a.args = []string{"doctor"}
		deps.Runner.(*systemtest.Runner).OnFunc("docker version", func(system.Cmd) system.Result {
			panic("synthetic-primary-secret /home/alice")
		})
	}
	result := noticeShutdownResult{}
	start := func(ctx context.Context, _ *cobra.Command, _ []string) func() string {
		found := make(chan *system.CapturedPanic, 1)
		done := make(chan struct{})
		release := make(chan struct{})
		go func() {
			defer close(done)
			if mode == "blocked" {
				<-release
			}
			var crash *system.CapturedPanic
			if mode == "ready-panic" || mode == "primary-panic" {
				crash = system.CatchPanic(noticeShutdownWorker)
			}
			found <- crash
		}()
		if mode != "blocked" {
			<-done
		}
		t.Cleanup(func() { close(release); <-done })
		return func() string {
			if ctx.Err() != nil {
				result.Rejected = true
				select {
				case crash := <-found:
					if crash != nil {
						panic(*crash)
					}
				default:
				}
				return ""
			}
			result.Accepted = true
			return "synthetic unused notice"
		}
	}
	defer func() {
		crash := recover()
		result.Events = net.Events()
		data, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(os.Args[len(os.Args)-1], data, 0o600); err != nil {
			t.Fatal(err)
		}
		if crash != nil {
			panic(crash)
		}
	}()
	if code := a.runWithNotice(context.Background(), start); code != ExitError {
		t.Fatalf("ordinary command exit = %d", code)
	}
	t.Fail()
}
