package cli_test

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

const noticeSentence = "self-host sends anonymous usage data, never paths or secrets. Turn it off with SELF_HOST_NO_TELEMETRY=1 (details in the README)."

// telemetryDeps is a release build with a project key and a fake PostHog, so
// Telemetry is on; every other test leaves both off.
func telemetryDeps(t *testing.T) (*system.Deps, *telemetrytest.Transport) {
	t.Helper()
	key := telemetry.ProjectKey
	telemetry.ProjectKey = "phc_test"
	t.Cleanup(func() { telemetry.ProjectKey = key })
	deps := systemtest.NewDeps(t)
	deps.Version = "1.2.3"
	net := &telemetrytest.Transport{}
	deps.HTTP = &http.Client{Transport: net}
	return deps, net
}

func commandEvents(net *telemetrytest.Transport) []map[string]any {
	var out []map[string]any
	for _, e := range net.Events() {
		if e["event"] == "command" {
			out = append(out, e["properties"].(map[string]any))
		}
	}
	return out
}

func TestTheFirstPlainCommandAnnouncesTelemetryOnceAndReportsEveryCommand(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})

	first := clitest.Run(t, deps, cat, "apps", "list")
	second := clitest.Run(t, deps, cat, "apps", "list")

	if got := strings.Count(first.Out, noticeSentence); got != 1 {
		t.Errorf("first run printed the notice %d times, want once:\n%s", got, first.Out)
	}
	if strings.Contains(second.Out, noticeSentence) {
		t.Errorf("second run printed the notice again:\n%s", second.Out)
	}
	if _, err := os.Stat(filepath.Join(clitest.Root(t, deps), "telemetry-notice")); err != nil {
		t.Errorf("no notice marker in the Home folder: %v", err)
	}
	events := commandEvents(net)
	if len(events) != 2 {
		t.Fatalf("got %d command events, want 2", len(events))
	}
	for key, want := range map[string]any{"command": "apps list", "outcome": "ok", "version": "1.2.3", "os": "linux", "arch": "amd64"} {
		if events[0][key] != want {
			t.Errorf("properties[%q] = %v, want %v", key, events[0][key], want)
		}
	}
}

func TestNothingIsSentUntilAPlainCommandHasShownTheNotice(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	json := clitest.Run(t, deps, cat, "apps", "list", "--json")
	if strings.Contains(json.Out, noticeSentence) || len(net.Bodies()) != 0 {
		t.Fatalf("a --json command announced or sent before the notice:\n%s\n%v", json.Out, net.Bodies())
	}
	clitest.Run(t, deps, cat, "apps", "list")
	clitest.Run(t, deps, cat, "apps", "list", "--json")

	if got := len(commandEvents(net)); got != 2 {
		t.Fatalf("got %d command events after the notice, want 2", got)
	}
}

func TestTelemetryIsOffWhereTheOffSwitchesSay(t *testing.T) {
	cases := []struct {
		name  string
		tweak func(deps *system.Deps)
	}{
		{"SELF_HOST_NO_TELEMETRY", func(d *system.Deps) { systemtest.SetEnv(d, map[string]string{"SELF_HOST_NO_TELEMETRY": "1"}) }},
		{"DO_NOT_TRACK", func(d *system.Deps) { systemtest.SetEnv(d, map[string]string{"DO_NOT_TRACK": "1"}) }},
		{"CI", func(d *system.Deps) { systemtest.SetEnv(d, map[string]string{"CI": "true"}) }},
		{"development build", func(d *system.Deps) { d.Version = "dev" }},
		{"test build", func(d *system.Deps) { d.Version = "test" }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			deps, net := telemetryDeps(t)
			c.tweak(deps)
			r := clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "list")
			if strings.Contains(r.Out, noticeSentence) || len(net.Bodies()) != 0 {
				t.Fatalf("announced or sent while off:\n%s\n%v", r.Out, net.Bodies())
			}
		})
	}
}

func TestTelemetryIsOffInTestsByDefault(t *testing.T) {
	deps := systemtest.NewDeps(t)
	net := &telemetrytest.Transport{}
	deps.HTTP = &http.Client{Transport: net}
	r := clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "list")
	if strings.Contains(r.Out, noticeSentence) || len(net.Bodies()) != 0 {
		t.Fatalf("a default test announced or sent:\n%s\n%v", r.Out, net.Bodies())
	}
}

func TestAnInstallReportsItsIDsAccessAndFailedSteps(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	clitest.Run(t, deps, cat, "apps", "list")
	deps.Runner.(*systemtest.Runner).OnStreamError("--progress json pull", "", errors.New("exit status 125"))

	r := clitest.Run(t, deps, cat, "install", "pair", "one", "--yes", "--exposure", "local", "--json")

	if r.Code == 0 {
		t.Fatal("install succeeded despite the failed pull")
	}
	events := commandEvents(net)
	install := events[len(events)-1]
	if install["command"] != "install" {
		t.Fatalf("last command event = %v, want install", install)
	}
	for key, want := range map[string]any{
		"recipes":      []any{"pair"},
		"apps":         []any{"one"},
		"access":       "local",
		"failed_steps": []any{"one/pull", "two/pull", "pull"},
	} {
		if !reflect.DeepEqual(install[key], want) {
			t.Errorf("properties[%q] = %v, want %v", key, install[key], want)
		}
	}
	if install["outcome"] != "failed" && install["outcome"] != "incomplete" {
		t.Errorf("outcome = %v, want failed or incomplete", install["outcome"])
	}
	var exceptions []map[string]any
	for _, e := range net.Events() {
		if e["event"] == "$exception" {
			exceptions = append(exceptions, e["properties"].(map[string]any))
		}
	}
	if len(exceptions) != 1 || exceptions[0]["$exception_fingerprint"] != "install|StepFailed|one/pull,pull,two/pull" {
		t.Fatalf("exceptions = %v, want one StepFailed fingerprint install|StepFailed|one/pull,pull,two/pull", exceptions)
	}
}

func TestNoPathHostNameInputOrSecretIsSentByAnyCommand(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	seeded := []string{"/srv/nowhere", "/home/alice/media", "nas.example.com", "hunter2-s3cret", "alice-admin", "alice-laptop", "192.168.1.20", clitest.Root(t, deps)}
	systemtest.SetEnv(deps, map[string]string{"SELF_HOST_ADMIN_PASSWORD": "hunter2-s3cret"})
	clitest.Run(t, deps, cat, "apps", "list")
	deps.Runner.(*systemtest.Runner).OnStreamError("--progress json pull", "", errors.New("exit status 125: /srv/nowhere hunter2-s3cret"))

	clitest.Run(t, deps, cat, "install", "pair", "nas.example.com", "/srv/nowhere", "--yes", "--json",
		"--exposure", "nas.example.com", "--media-root", "/home/alice/media", "--admin-user", "alice-admin", "--set", "one.token=hunter2-s3cret")
	clitest.Run(t, deps, cat, "install", "pair", "--yes", "--json", "--media-root", "/home/alice/media", "--admin-user", "alice-admin")
	clitest.Run(t, deps, cat, "setup", "nas.example.com", "/srv/nowhere")
	clitest.Run(t, deps, cat, "no-such-command", "alice-laptop", "192.168.1.20")

	bodies := net.Bodies()
	if len(bodies) < 3 {
		t.Fatalf("captured %d payloads, want at least 3", len(bodies))
	}
	for _, body := range bodies {
		for _, value := range seeded {
			if strings.Contains(body, value) {
				t.Errorf("payload carries %q:\n%s", value, body)
			}
		}
	}
}

func TestASlowTelemetryEndpointNeverDelaysACommand(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	clitest.Run(t, deps, cat, "apps", "list")
	hold := make(chan struct{})
	t.Cleanup(func() { close(hold) })
	net.Hold = hold

	start := time.Now()
	r := clitest.Run(t, deps, cat, "apps", "list")

	if took := time.Since(start); took > 3*time.Second || r.Code != 0 {
		t.Fatalf("command took %v and exited %d with Telemetry's endpoint never answering", took, r.Code)
	}
}
