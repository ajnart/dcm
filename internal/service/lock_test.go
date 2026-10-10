package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestCanceledQueuedConfigSetDoesNotStartOrEdit(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	p, err := h.svc.Project()
	if err != nil {
		t.Fatal(err)
	}
	settings, err := p.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	beforeCalls := h.runner.Calls()
	h.rec.mu.Lock()
	beforeEvents := len(h.rec.events)
	h.rec.mu.Unlock()
	unlock, err := p.Lock(h.deps.PID, h.deps.ProcessAlive)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		done <- h.svc.ConfigSet(ctx, []string{"LAN_IP=10.9.9.9"})
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("want canceled queued config operation, got %v", err)
		}
	case <-time.After(time.Second):
		// Let a broken waiter finish before the harness directory is removed.
		unlock()
		<-done
		t.Fatal("canceled ConfigSet kept waiting for the current mutation")
	}
	got, err := p.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, settings) {
		t.Fatalf("canceled queued operation changed Host settings: got %v, want %v", got, settings)
	}
	if calls := h.runner.Calls(); !reflect.DeepEqual(calls, beforeCalls) {
		t.Fatalf("canceled queued operation ran an external command: %v", calls[len(beforeCalls):])
	}
	h.rec.mu.Lock()
	defer h.rec.mu.Unlock()
	if len(h.rec.events) != beforeEvents {
		t.Fatalf("canceled queued operation emitted progress events: %v", h.rec.events[beforeEvents:])
	}
}
