package cli_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"github.com/ajnart/self-host/internal/telemetry"
	"github.com/ajnart/self-host/internal/telemetry/telemetrytest"
)

const noticeSentence = "Anonymous usage data helps improve self-host: no IP, no personal data. Details: https://github.com/ajnart/selfhost-skills/wiki/Telemetry"

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

func TestUpdateWorkerPanicIsFlushedBeforeTheProcessCrashes(t *testing.T) {
	file := filepath.Join(t.TempDir(), "synthetic-payload.json")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestUpdateWorkerPanicChild$", "--", file)
	cmd.Env = []string{"SELF_HOST_WORKER_PANIC_CHILD=1"}
	out, err := cmd.CombinedOutput()
	if err == nil || ctx.Err() != nil {
		t.Fatalf("child did not crash promptly: %v\n%s", err, out)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("no payload was flushed before the worker crash: %v\n%s", err, out)
	}
	var sent []map[string]any
	if err := json.Unmarshal(data, &sent); err != nil {
		t.Fatal(err)
	}
	var exception map[string]any
	for _, e := range sent {
		if e["event"] == "$exception" {
			exception = e["properties"].(map[string]any)
		}
	}
	if exception == nil || exception["command"] != "status" {
		t.Fatalf("no status exception: %s", data)
	}
	item := exception["$exception_list"].([]any)[0].(map[string]any)
	if item["mechanism"].(map[string]any)["handled"] != false || item["value"] != "panic" {
		t.Fatalf("not an unhandled panic: %v", item)
	}
	var originalWorker bool
	for _, frame := range item["stacktrace"].(map[string]any)["frames"].([]any) {
		f := frame.(map[string]any)
		if f["function"] == "internal/service.(*Service).imageUpdate" && f["filename"] == "internal/service/updates.go" {
			originalWorker = true
		}
	}
	if !originalWorker {
		t.Fatalf("original worker frames were lost: %v", item)
	}
	for _, forbidden := range []string{"synthetic-worker-secret", "/home/alice", "alice-laptop"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("panic payload leaks %q", forbidden)
		}
	}
	if !strings.Contains(string(out), "synthetic-worker-secret /home/alice alice-laptop") {
		t.Fatalf("original panic value did not reach the crash: %s", out)
	}
}

func TestUpdateWorkerPanicChild(t *testing.T) {
	if os.Getenv("SELF_HOST_WORKER_PANIC_CHILD") != "1" {
		return
	}
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	clitest.Run(t, deps, cat, "install", "one", "--yes")
	deps.Runner.(*systemtest.Runner).OnFunc("docker image inspect", func(system.Cmd) system.Result {
		panic("synthetic-worker-secret /home/alice alice-laptop")
	})
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
	clitest.Run(t, deps, cat, "status", "--updates")
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

func TestTelemetryUsesTheHomeAccessIDForLAN(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	r := clitest.Run(t, deps, cat, "install", "one", "--yes", "--exposure", "lan")
	if r.Code != 0 {
		t.Fatalf("install: %d\n%s", r.Code, r.Out)
	}
	events := commandEvents(net)
	if got := events[len(events)-1]["access"]; got != "home" {
		t.Fatalf("access = %v, want home", got)
	}
}

func TestTelemetryResolvesAnOverlappingNameAsARecipeBeforeAnApp(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := catalog.New([]app.App{&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}}}, []catalog.Recipe{{ID: "one", Apps: []string{"two"}}})
	r := clitest.Run(t, deps, cat, "install", "one", "--yes")
	if r.Code != 0 {
		t.Fatalf("install: %d\n%s", r.Code, r.Out)
	}
	events := commandEvents(net)
	props := events[len(events)-1]
	if !reflect.DeepEqual(props["recipes"], []any{"one"}) || props["apps"] != nil {
		t.Fatalf("namespace overlap did not resolve as Recipe: %v", props)
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

func exceptionProps(net *telemetrytest.Transport) []map[string]any {
	var out []map[string]any
	for _, e := range net.Events() {
		if e["event"] == "$exception" {
			out = append(out, e["properties"].(map[string]any))
		}
	}
	return out
}

func TestThePlainNoticeLinksTheWikiAndNamesNoOffSwitch(t *testing.T) {
	deps, _ := telemetryDeps(t)
	r := clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "list")
	if !strings.Contains(r.Out, "https://github.com/ajnart/selfhost-skills/wiki/Telemetry") {
		t.Fatalf("the notice does not link the wiki:\n%s", r.Out)
	}
	for _, banned := range []string{"SELF_HOST_NO_TELEMETRY", "DO_NOT_TRACK", "turn it off", "Turn off"} {
		if strings.Contains(r.Out, banned) {
			t.Errorf("the notice names the off switch with %q:\n%s", banned, r.Out)
		}
	}
}

func TestTheInstallIDSurvivesDeletingTheHomeFolder(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	clitest.Run(t, deps, cat, "apps", "list")
	clitest.Run(t, deps, cat, "apps", "list")

	if err := os.RemoveAll(clitest.Root(t, deps)); err != nil {
		t.Fatal(err)
	}
	clitest.Run(t, deps, cat, "apps", "list")
	clitest.Run(t, deps, cat, "apps", "list")

	if _, err := deps.ConfigFiles.(*systemtest.ConfigFiles).ReadConfigFile("telemetry-id"); err != nil {
		t.Fatalf("no install ID in the user config folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(clitest.Root(t, deps), "telemetry-id")); err == nil {
		t.Error("a new install ID was written to the Home folder")
	}
	ids := map[any]bool{}
	for _, e := range net.Events() {
		ids[e["distinct_id"]] = true
	}
	if len(ids) != 1 || len(net.Events()) != 4 {
		t.Fatalf("distinct IDs = %v over %d events, want one ID over 4 events", ids, len(net.Events()))
	}
}

func TestAnInstallIDInTheHomeFolderIsMigrated(t *testing.T) {
	const legacy = "6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10"
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	if err := os.MkdirAll(clitest.Root(t, deps), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(clitest.Root(t, deps), "telemetry-id"), []byte(legacy+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	clitest.Run(t, deps, cat, "apps", "list")

	if got := net.Events()[0]["distinct_id"]; got != legacy {
		t.Fatalf("distinct_id = %v, want the Home folder's %s", got, legacy)
	}
	data, err := deps.ConfigFiles.(*systemtest.ConfigFiles).ReadConfigFile("telemetry-id")
	if err != nil || strings.TrimSpace(string(data)) != legacy {
		t.Fatalf("config telemetry-id = %q, %v, want %s", data, err, legacy)
	}
}

func TestEventsKeepPersonProfilesAndSendNoIP(t *testing.T) {
	deps, net := telemetryDeps(t)
	clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "list")
	events := net.Events()
	if len(events) == 0 {
		t.Fatal("nothing was sent")
	}
	for _, e := range events {
		props := e["properties"].(map[string]any)
		if _, found := props["$process_person_profile"]; found {
			t.Errorf("%v disables person profiles", e["event"])
		}
		if _, found := props["$ip"]; found {
			t.Errorf("%v carries $ip", e["event"])
		}
		if props["$geoip_disable"] != true {
			t.Errorf("%v: $geoip_disable = %v, want true", e["event"], props["$geoip_disable"])
		}
	}
}

func TestACommandEventCarriesItsStepsWithIDOutcomeAndDuration(t *testing.T) {
	deps, net := telemetryDeps(t)
	slow := &echoApp{id: "one", done: map[string]bool{}}
	slow.slow = func(ctx context.Context) { deps.Sleep(ctx, 2500*time.Millisecond) }
	cat := testCatalog(slow, &echoApp{id: "two", done: map[string]bool{}})
	clitest.Run(t, deps, cat, "apps", "list")

	clitest.Run(t, deps, cat, "install", "pair", "--yes", "--json")

	events := commandEvents(net)
	install := events[len(events)-1]
	if install["command"] != "install" {
		t.Fatalf("last command event = %v, want install", install)
	}
	var configure map[string]any
	for _, s := range install["steps"].([]any) {
		if step := s.(map[string]any); step["id"] == "one/configure" {
			configure = step
		}
	}
	want := map[string]any{"id": "one/configure", "outcome": "ok", "duration_ms": float64(2500)}
	if !reflect.DeepEqual(configure, want) {
		t.Fatalf("one/configure = %v in steps %v, want %v", configure, install["steps"], want)
	}
}

func TestAFailedStepIsAnErrorLogAndAnExceptionWithInAppFrames(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, fail: errors.New("boom /srv/nowhere")})
	clitest.Run(t, deps, cat, "apps", "list")

	clitest.Run(t, deps, cat, "install", "one", "--yes", "--json")

	exceptions := exceptionProps(net)
	if len(exceptions) != 1 {
		t.Fatalf("got %d exceptions, want 1", len(exceptions))
	}
	item := exceptions[0]["$exception_list"].([]any)[0].(map[string]any)
	frames := item["stacktrace"].(map[string]any)["frames"].([]any)
	if len(frames) == 0 {
		t.Fatal("no frames")
	}
	for _, f := range frames {
		if file := f.(map[string]any)["filename"].(string); strings.HasPrefix(file, "/") || !strings.HasPrefix(file, "internal/") {
			t.Errorf("filename %q is not module-relative", file)
		}
	}
	logs := net.LogRecords()
	if len(logs) != 1 || logs[0]["severityText"] != "ERROR" || logs[0]["step"] != "one/configure" {
		t.Fatalf("log records = %v, want one ERROR for one/configure", logs)
	}
}

func TestAPanicIsSentAsAnUnhandledExceptionBeforeTheProcessCrashesAsBefore(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, crash: "disk /home/alice is full: hunter2-s3cret"})
	clitest.Run(t, deps, cat, "apps", "list")

	var recovered any
	func() {
		defer func() { recovered = recover() }()
		clitest.Run(t, deps, cat, "install", "one", "--yes", "--json")
	}()

	if recovered != "disk /home/alice is full: hunter2-s3cret" {
		t.Fatalf("the panic was swallowed or changed: %v", recovered)
	}
	exceptions := exceptionProps(net)
	if len(exceptions) != 1 {
		t.Fatalf("got %d exceptions, want 1: %v", len(exceptions), net.Events())
	}
	item := exceptions[0]["$exception_list"].([]any)[0].(map[string]any)
	if item["type"] != "string" || item["value"] != "panic" || item["mechanism"].(map[string]any)["handled"] != false {
		t.Errorf("exception = %v, want an unhandled string panic", item)
	}
	frames := item["stacktrace"].(map[string]any)["frames"].([]any)
	last := frames[len(frames)-1].(map[string]any)
	if last["function"] != "internal/cli_test.(*echoApp).Setup.func2" {
		t.Errorf("innermost frame = %v, want the panicking step in the test App", last)
	}
	command := commandEvents(net)
	if got := command[len(command)-1]; got["command"] != "install" || got["outcome"] != "failed" {
		t.Errorf("command event = %v, want a failed install", got)
	}
	if strings.Contains(strings.Join(net.Bodies(), "\n"), "hunter2-s3cret") {
		t.Error("the panic value was sent")
	}
}

func TestNoAbsolutePathOrHostNameIsSentInAStackFrame(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, fail: errors.New("boom")})
	clitest.Run(t, deps, cat, "apps", "list")
	clitest.Run(t, deps, cat, "install", "one", "--yes", "--json")
	_, thisFile, _, _ := runtime.Caller(0)
	seeded := []string{filepath.Dir(thisFile), filepath.Dir(filepath.Dir(filepath.Dir(thisFile))), clitest.Root(t, deps)}
	if host, err := os.Hostname(); err == nil && len(host) >= 6 {
		seeded = append(seeded, host)
	}
	if len(exceptionProps(net)) == 0 {
		t.Fatal("no exception, so the test proves nothing")
	}
	for _, body := range net.Bodies() {
		for _, value := range seeded {
			if strings.Contains(body, value) {
				t.Errorf("payload carries %q:\n%s", value, body)
			}
		}
	}
}

func TestTelemetryDoesNotTouchConfigPathsWithFakeDependencies(t *testing.T) {
	deps, net := telemetryDeps(t)
	unused := filepath.Join(t.TempDir(), "must-not-be-created")
	deps.ConfigDir = func() (string, error) { return unused, nil }
	clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "apps", "list")
	if len(net.Events()) != 1 {
		t.Fatal("fake persistence did not allow reporting")
	}
	if _, err := os.Stat(unused); !os.IsNotExist(err) {
		t.Fatalf("telemetry touched an OS config path with fake dependencies: %v", err)
	}
}
