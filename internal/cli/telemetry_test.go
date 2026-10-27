package cli_test

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
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

const noticeMarker = "Anonymous usage data"

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
	return exceptionProps(net)
}

func failPull(deps *system.Deps) {
	deps.Runner.(*systemtest.Runner).OnStreamError("--progress json pull", "", errors.New("exit status 125"))
}

func TestACommandPrintsNoNoticeAndASuccessfulInstallSendsNothing(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})

	first := clitest.Run(t, deps, cat, "install", "one", "--yes")
	second := clitest.Run(t, deps, cat, "install", "one", "--yes")

	if first.Code != 0 || second.Code != 0 {
		t.Fatalf("install exited %d and %d\n%s", first.Code, second.Code, first.Out)
	}
	if strings.Contains(first.Out+second.Out, noticeMarker) {
		t.Errorf("a command printed the Telemetry notice:\n%s\n%s", first.Out, second.Out)
	}
	if got := len(net.Bodies()); got != 0 {
		t.Fatalf("successful installs sent %d requests, want 0: %v", got, net.Bodies())
	}
}

func TestAFailedJSONCommandIsReported(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	failPull(deps)

	r := clitest.Run(t, deps, cat, "install", "one", "--yes", "--json")

	if r.Code == 0 || len(exceptionProps(net)) != 1 {
		t.Fatalf("exit %d, sent %v, want one exception", r.Code, net.Bodies())
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
			r := clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "status")
			if r.Code == 0 || strings.Contains(r.Out, noticeMarker) || len(net.Bodies()) != 0 {
				t.Fatalf("announced or sent while off:\n%s\n%v", r.Out, net.Bodies())
			}
		})
	}
}

func TestTelemetryIsOffInTestsByDefault(t *testing.T) {
	deps := systemtest.NewDeps(t)
	net := &telemetrytest.Transport{}
	deps.HTTP = &http.Client{Transport: net}
	r := clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "status")
	if r.Code == 0 || strings.Contains(r.Out, noticeMarker) || len(net.Bodies()) != 0 {
		t.Fatalf("a default test announced or sent:\n%s\n%v", r.Out, net.Bodies())
	}
}

func TestAnInstallReportsItsIDsAccessAndFailedSteps(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
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
	failPull(deps)
	r := clitest.Run(t, deps, cat, "install", "one", "--yes", "--exposure", "lan")
	if r.Code == 0 {
		t.Fatalf("install succeeded despite the failed pull:\n%s", r.Out)
	}
	events := commandEvents(net)
	if got := events[len(events)-1]["access"]; got != "home" {
		t.Fatalf("access = %v, want home", got)
	}
}

func TestTelemetryResolvesAnOverlappingNameAsARecipeBeforeAnApp(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := catalog.New([]app.App{&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}}}, []catalog.Recipe{{ID: "one", Apps: []string{"two"}}})
	failPull(deps)
	r := clitest.Run(t, deps, cat, "install", "one", "--yes")
	if r.Code == 0 {
		t.Fatalf("install succeeded despite the failed pull:\n%s", r.Out)
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
	clitest.Run(t, deps, cat, "status")
	hold := make(chan struct{})
	t.Cleanup(func() { close(hold) })
	net.Hold = hold
	before := len(net.Bodies())

	start := time.Now()
	r := clitest.Run(t, deps, cat, "status")

	if took := time.Since(start); took > 3*time.Second || r.Code == 0 {
		t.Fatalf("command took %v and exited %d with Telemetry's endpoint never answering", took, r.Code)
	}
	if len(net.Bodies()) == before {
		t.Fatal("the request never started, so the test proves nothing")
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

func TestNoIDFileIsEverSaved(t *testing.T) {
	deps, net := telemetryDeps(t)
	config := filepath.Join(t.TempDir(), "config")
	deps.ConfigDir = func() (string, error) { return config, nil }
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	failPull(deps)
	clitest.Run(t, deps, cat, "install", "one", "--yes")
	clitest.Run(t, deps, cat, "install", "one", "--yes")
	if len(exceptionProps(net)) != 2 {
		t.Fatalf("got %d exceptions, want 2", len(exceptionProps(net)))
	}
	for _, root := range []string{clitest.Root(t, deps), config, filepath.Dir(config)} {
		filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() && (strings.Contains(d.Name(), "telemetry-id") || strings.Contains(d.Name(), "install-id")) {
				t.Errorf("an ID file was saved: %s", path)
			}
			return nil
		})
	}
	if _, err := os.Stat(config); err == nil {
		t.Error("the user config folder was created")
	}
}

func TestEventsAreAnonymousAndSendNoIP(t *testing.T) {
	deps, net := telemetryDeps(t)
	failPull(deps)
	clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "install", "one", "--yes")
	events := net.Events()
	if len(events) == 0 {
		t.Fatal("nothing was sent")
	}
	for _, e := range events {
		props := e["properties"].(map[string]any)
		if props["$process_person_profile"] != false {
			t.Errorf("%v: $process_person_profile = %v, want false", e["event"], props["$process_person_profile"])
		}
		if _, found := props["$ip"]; found {
			t.Errorf("%v carries $ip", e["event"])
		}
		if _, found := props["$set"]; found {
			t.Errorf("%v sets person properties", e["event"])
		}
		if props["$geoip_disable"] != true {
			t.Errorf("%v: $geoip_disable = %v, want true", e["event"], props["$geoip_disable"])
		}
	}
}

func TestAnExceptionCarriesItsStepsWithIDOutcomeAndDuration(t *testing.T) {
	deps, net := telemetryDeps(t)
	slow := &echoApp{id: "one", done: map[string]bool{}}
	slow.slow = func(ctx context.Context) { deps.Sleep(ctx, 2500*time.Millisecond) }
	cat := testCatalog(slow, &echoApp{id: "two", done: map[string]bool{}, fail: errors.New("boom")})

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
	if got := exceptions[0]; got["command"] != "install" || got["outcome"] != "failed" {
		t.Errorf("exception = %v, want a failed install", got)
	}
	if strings.Contains(strings.Join(net.Bodies(), "\n"), "hunter2-s3cret") {
		t.Error("the panic value was sent")
	}
}

func TestNoAbsolutePathOrHostNameIsSentInAStackFrame(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}, fail: errors.New("boom")})
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
	failPull(deps)
	clitest.Run(t, deps, testCatalog(&echoApp{id: "one", done: map[string]bool{}}), "install", "one", "--yes")
	if len(net.Events()) != 1 {
		t.Fatal("fake persistence did not allow reporting")
	}
	if _, err := os.Stat(unused); !os.IsNotExist(err) {
		t.Fatalf("telemetry touched an OS config path with fake dependencies: %v", err)
	}
}

func TestProfileSetExperienceSendsNothing(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	r := clitest.Run(t, deps, cat, "profile", "set", "experience", "advanced")

	if r.Code != 0 || len(net.Bodies()) != 0 {
		t.Fatalf("profile set exited %d and sent %v, want success and nothing", r.Code, net.Bodies())
	}
}

func TestASuccessfulStatusSendsNothing(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	clitest.Run(t, deps, cat, "install", "one", "--yes")
	before := len(net.Events())

	r := clitest.Run(t, deps, cat, "status")

	if r.Code != 0 {
		t.Fatalf("status: %d\n%s", r.Code, r.Out)
	}
	if got := len(net.Events()) - before; got != 0 {
		t.Fatalf("sent %d events for a successful status, want 0: %v", got, net.Events())
	}
}

func TestAFailedStatusSendsOneException(t *testing.T) {
	deps, net := telemetryDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})

	r := clitest.Run(t, deps, cat, "status")

	if r.Code == 0 {
		t.Fatalf("status without a Project succeeded:\n%s", r.Out)
	}
	var names []any
	for _, e := range net.Events() {
		names = append(names, e["event"])
	}
	if !reflect.DeepEqual(names, []any{"$exception"}) {
		t.Fatalf("events = %v, want one $exception", names)
	}
}
