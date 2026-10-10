package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/system"
)

func TestCanceledFirstInstallDoesNotCreateProject(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := h.svc.Install(ctx, InstallOptions{Targets: []string{"one"}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("install = %v, want canceled", err)
	}
	p, err := h.svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	if p.Exists() {
		t.Fatal("canceled first install created active Project settings")
	}
}

type inputApp struct{ *testApp }

func (a *inputApp) Inputs() []app.Input {
	return []app.Input{{Key: "first", Default: "old-first"}, {Key: "second", Default: "old-second"}}
}

func (a *inputApp) Compose(rc app.RenderContext) string {
	return fmt.Sprintf("services:\n  one:\n    image: example/test:latest\n    environment:\n      FIRST: %s\n      SECOND: %s\n", rc.Inputs["first"], rc.Inputs["second"])
}

func TestQueuedInstallsPreserveOtherInputChanges(t *testing.T) {
	h := newHarness(t, &inputApp{testApp: &testApp{id: "one", done: map[string]bool{}}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	p, err := h.svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := p.Lock(h.deps.PID, h.deps.ProcessAlive)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ready := make(chan struct{}, 2)
	h.runner.OnFunc("docker compose version", func(system.Cmd) system.Result {
		ready <- struct{}{}
		return system.Result{Stdout: []byte("2.29.7\n")}
	})
	errs := make(chan error, 2)
	for _, set := range []string{"one.first=new-first", "one.second=new-second"} {
		go func() {
			errs <- h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, Sets: []string{set}})
		}()
	}
	for range 2 {
		select {
		case <-ready:
		case <-time.After(3 * time.Second):
			t.Fatal("installs did not reach the held Project lock")
		}
	}
	unlock()
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	compose, err := h.svc.Compose(context.Background(), "one")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(compose, "FIRST: new-first") || !strings.Contains(compose, "SECOND: new-second") {
		t.Fatalf("one queued install lost the other's input:\n%s", compose)
	}
}
