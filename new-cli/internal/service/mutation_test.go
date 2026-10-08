package service

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// testApp is a one-service catalog App whose Setup lives in a map.
type testApp struct {
	id    string
	image string
	lanIP bool
	fail  error
	done  map[string]bool
}

func (a *testApp) Info() app.Info {
	image := a.image
	if image == "" {
		image = "example/test:latest"
	}
	return app.Info{ID: a.id, Name: a.id, Image: image, Port: 9000, ContainerPort: 80, Service: a.id}
}

func (a *testApp) Inputs() []app.Input { return nil }

func (a *testApp) Compose(app.RenderContext) string {
	env := ""
	if a.lanIP {
		env = "    environment:\n      BASE_URL: http://${LAN_IP}\n"
	}
	return "services:\n  " + a.id + ":\n    image: " + a.Info().Image + "\n" + env
}

func (a *testApp) Setup(ctx context.Context, h *helpers.H) error {
	return h.Step(ctx, "configure", "configure "+a.id, helpers.StepSpec{
		Check: func(context.Context) (bool, error) { return a.done[a.id], nil },
		Do: func(context.Context) error {
			if a.fail != nil {
				return a.fail
			}
			a.done[a.id] = true
			return nil
		},
	})
}

func (a *testApp) Check(context.Context, *helpers.H) error { return nil }
func (a *testApp) Links() []app.Link                       { return nil }

// recorder keeps every event so tests can assert the progress stream.
type recorder struct {
	mu     sync.Mutex
	events []events.Event
}

func (r *recorder) Emit(e events.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func (r *recorder) find(app, step string) *events.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	var found *events.Event
	for i := range r.events {
		e := r.events[i]
		if e.App == app && e.Step == step && e.Event != events.StepStart {
			found = &e
		}
	}
	return found
}

func (r *recorder) last() events.Event {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.events) == 0 {
		return events.Event{}
	}
	return r.events[len(r.events)-1]
}

type harness struct {
	t      *testing.T
	deps   *system.Deps
	runner *systemtest.Runner
	svc    *Service
	rec    *recorder
}

func newHarness(t *testing.T, apps ...app.App) *harness {
	t.Helper()
	deps := systemtest.NewDeps(t)
	rec := &recorder{}
	svc := New(deps, events.New(rec), catalog.New(apps, nil))
	return &harness{t: t, deps: deps, runner: deps.Runner.(*systemtest.Runner), svc: svc, rec: rec}
}

func (h *harness) root() string {
	h.t.Helper()
	user, err := h.deps.CurrentUser()
	if err != nil {
		h.t.Fatal(err)
	}
	return filepath.Join(user.Home, "self-host")
}

func (h *harness) install(ids ...string) error {
	h.t.Helper()
	return h.svc.Install(context.Background(), InstallOptions{Targets: ids})
}

// composeCalls lists the Compose subcommands, in order.
func (h *harness) composeCalls() []string {
	var out []string
	for _, line := range h.runner.Calls() {
		if _, rest, found := strings.Cut(line, "secrets.env "); found {
			out = append(out, rest)
		}
	}
	return out
}

func assertCalls(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("compose calls = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("compose calls = %v, want %v", got, want)
		}
	}
}

func TestInstallRendersPullsUpAndSetup(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	stateAtPull := ""
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "--progress json pull") {
			data, err := os.ReadFile(filepath.Join(h.root(), "state.json"))
			if err == nil {
				stateAtPull = string(data)
			}
		}
		return system.Result{}
	})

	if err := h.install("one"); err != nil {
		t.Fatalf("install: %v", err)
	}
	assertCalls(t, h.composeCalls(), []string{"--progress json pull one", "up -d one"})
	if e := h.rec.find("one", "render"); e == nil || e.Event != events.StepOK {
		t.Fatalf("render step missing: %+v", e)
	}
	if e := h.rec.find("one", "configure"); e == nil || e.Event != events.StepOK {
		t.Fatalf("setup did not run: %+v", e)
	}
	if !strings.Contains(stateAtPull, `"one"`) {
		t.Fatalf("state was not saved before pull: %q", stateAtPull)
	}
}

func TestUpdatePullsBeforeUpThenCheck(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatalf("install: %v", err)
	}
	before := len(h.composeCalls())

	if err := h.svc.Update(context.Background(), []string{"one"}); err != nil {
		t.Fatalf("update: %v", err)
	}
	assertCalls(t, h.composeCalls()[before:], []string{"--progress json pull one", "up -d one"})
	if e := h.rec.find("one", "check"); e == nil || e.Event != events.StepOK {
		t.Fatalf("update did not run Check: %+v", e)
	}
}

func TestStartUsesUpOnly(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatalf("install: %v", err)
	}
	pulls := strings.Count(strings.Join(h.composeCalls(), "\n"), "--progress json pull")

	if err := h.svc.Start(context.Background(), []string{"one"}); err != nil {
		t.Fatalf("start: %v", err)
	}
	assertCalls(t, h.composeCalls()[2:], []string{"up -d one"})
	if again := strings.Count(strings.Join(h.composeCalls(), "\n"), "--progress json pull"); again != pulls {
		t.Fatalf("start pulled: %d pulls, want %d", again, pulls)
	}
	if err := h.svc.Down(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertCalls(t, h.composeCalls()[3:], []string{"down"})
	if err := h.svc.Start(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	assertCalls(t, h.composeCalls()[4:], []string{"up -d one"})
	p, err := h.svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p.FragmentPath("one")); err != nil {
		t.Fatal("Down removed the App's Compose file")
	}
}

func TestStartRemembersFailureAndRetryWithoutChangingSetupSteps(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	before, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " up -d one") {
			return system.Result{ExitCode: 1, Stderr: []byte("port is already allocated")}
		}
		return system.Result{}
	})
	if err := h.svc.Start(context.Background(), []string{"one"}); err == nil {
		t.Fatal("start succeeded despite Compose failure")
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	steps := status.Apps[0].Steps
	if len(steps) != 5 || steps[2].ID != "start" || steps[2].Status != "fail" || !strings.Contains(steps[2].Error, "port is already allocated") {
		t.Fatalf("start failure not remembered: %+v", steps)
	}
	if !reflect.DeepEqual(steps[3:], before.Apps[0].Steps[3:]) {
		t.Fatalf("start changed Setup steps: %+v", steps[3:])
	}
	h.runner.OnFunc("docker compose --project-directory", func(system.Cmd) system.Result { return system.Result{} })
	if err := h.svc.Start(context.Background(), []string{"one"}); err != nil {
		t.Fatal(err)
	}
	status, err = h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(status.Apps[0].Steps, before.Apps[0].Steps) {
		t.Fatalf("retry steps = %+v, want %+v", status.Apps[0].Steps, before.Apps[0].Steps)
	}
}

func TestSetupRunsNoCompose(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatalf("install: %v", err)
	}
	before := len(h.composeCalls())

	if err := h.svc.Setup(context.Background(), []string{"one"}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if after := len(h.composeCalls()); after != before {
		t.Fatalf("setup ran Compose: %v", h.composeCalls()[before:])
	}
	if e := h.rec.find("one", "configure"); e == nil {
		t.Fatal("setup did not run the App's step")
	}
}

func TestConfigSetRecreatesOnlyAffectedApps(t *testing.T) {
	h := newHarness(t,
		&testApp{id: "one", lanIP: true, done: map[string]bool{}},
		&testApp{id: "two", done: map[string]bool{}},
	)
	if err := h.install("one", "two"); err != nil {
		t.Fatalf("install: %v", err)
	}
	before := len(h.composeCalls())

	if err := h.svc.ConfigSet(context.Background(), []string{"LAN_IP=10.9.9.9"}); err != nil {
		t.Fatalf("config: %v", err)
	}
	assertCalls(t, h.composeCalls()[before:], []string{"up -d one"})
}

func TestRemoveDeletesComposeFragment(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatalf("install: %v", err)
	}
	before := len(h.composeCalls())

	if err := h.svc.Remove(context.Background(), []string{"one"}, false); err != nil {
		t.Fatalf("remove: %v", err)
	}
	assertCalls(t, h.composeCalls()[before:], []string{"rm --stop --force one"})
	if _, err := os.Stat(filepath.Join(h.root(), "apps", "one", "compose.yml")); !os.IsNotExist(err) {
		t.Fatal("fragment still on disk after remove")
	}
	if strings.Contains(strings.Join(h.composeCalls(), "\n"), "apps/one") {
		t.Fatal("removed app still in the root Compose file")
	}
}

func TestFailedPullStopsBeforeUp(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	h.runner.OnStreamError("--progress json pull", "", errors.New("exit status 125"))

	if err := h.install("one"); err == nil {
		t.Fatal("install succeeded despite a failed pull")
	}
	if calls := h.composeCalls(); len(calls) != 1 || calls[0] != "--progress json pull one" {
		t.Fatalf("Compose ran past the failed pull: %v", calls)
	}
	if e := h.rec.find("", "pull"); e == nil || e.Event != events.StepFail {
		t.Fatalf("pull failure not reported: %+v", e)
	}
}

func TestConcurrentInstallsSerialise(t *testing.T) {
	counting := &countingRunner{Runner: nil, delay: 20 * time.Millisecond}
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	counting.Runner = h.runner
	h.deps.Runner = counting

	if err := h.install("one"); err != nil {
		t.Fatalf("seed install: %v", err)
	}
	before := len(h.composeCalls())

	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			errs[i] = h.install("one")
		}(i)
	}
	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("install %d: %v", i, err)
		}
	}
	if counting.max > 1 {
		t.Fatalf("%d Compose commands overlapped in one process", counting.max)
	}
	assertCalls(t, h.composeCalls()[before:], []string{
		"--progress json pull one", "up -d one",
		"--progress json pull one", "up -d one",
	})
}

func TestSetupFailureIsIncomplete(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", fail: errors.New("greetings endpoint returned 500"), done: map[string]bool{}})

	err := h.install("one")

	if !errors.Is(err, ErrIncomplete) {
		t.Fatalf("install error = %v, want ErrIncomplete", err)
	}
	if e := h.rec.find("one", "configure"); e == nil || e.Event != events.StepFail {
		t.Fatalf("failing setup step not reported: %+v", e)
	}
	if last := h.rec.last(); last.Event != events.RunEnd || !strings.Contains(last.Msg, "setup incomplete") {
		t.Fatalf("run not ended as incomplete: %+v", last)
	}
}

// countingRunner records the most Compose commands ever in flight at once.
type countingRunner struct {
	system.Runner
	delay time.Duration

	mu       sync.Mutex
	inFlight int
	max      int
}

func (c *countingRunner) enter() {
	c.mu.Lock()
	c.inFlight++
	if c.inFlight > c.max {
		c.max = c.inFlight
	}
	c.mu.Unlock()
	time.Sleep(c.delay)
}

func (c *countingRunner) leave() {
	c.mu.Lock()
	c.inFlight--
	c.mu.Unlock()
}

func (c *countingRunner) Run(ctx context.Context, cmd system.Cmd) (system.Result, error) {
	if strings.Contains(systemtest.Line(cmd), "secrets.env ") {
		c.enter()
		defer c.leave()
	}
	return c.Runner.Run(ctx, cmd)
}

func (c *countingRunner) Stream(ctx context.Context, cmd system.Cmd, w io.Writer) error {
	if strings.Contains(systemtest.Line(cmd), "secrets.env ") {
		c.enter()
		defer c.leave()
	}
	return c.Runner.Stream(ctx, cmd, w)
}

func TestFailedStartDoesNotFailSetup(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " up -d one") {
			return system.Result{ExitCode: 1, Stderr: []byte("port is already allocated")}
		}
		return system.Result{}
	})
	if err := h.svc.Start(context.Background(), []string{"one"}); err == nil {
		t.Fatal("start succeeded despite Compose failure")
	}
	if err := h.svc.Setup(context.Background(), []string{"one"}); err != nil {
		t.Fatalf("Setup should not fail on a remembered start failure: %v", err)
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Apps[0].Setup != "ok" {
		t.Fatalf("Setup = %q, want ok: a failed start is not a Setup failure", status.Apps[0].Setup)
	}
}
