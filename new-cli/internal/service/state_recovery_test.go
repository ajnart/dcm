package service

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestStatusDuringMutationDoesNotRepairStateThenNextMutationRecoversLatest(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
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
	data, err := os.ReadFile(p.Path("state.json"))
	if err != nil {
		t.Fatal(err)
	}
	damaged := append(data, []byte("damaged tail")...)
	if err := os.WriteFile(p.Path("state.json"), damaged, 0o644); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := h.svc.Status(context.Background())
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Status could not read salvageable state: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Status waited for the long mutation's lock")
	}
	current, err := os.ReadFile(p.Path("state.json"))
	if err != nil || string(current) != string(damaged) {
		t.Fatalf("Status rewrote state during a mutation: %q, %v", current, err)
	}
	if _, err := os.Stat(p.Path("state.json.corrupt")); !os.IsNotExist(err) {
		t.Fatalf("Status changed recovery files: %v", err)
	}
	// The current owner saves newer state after Status read its snapshot.
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	state.Apps["one"].Inputs = map[string]string{"concurrent": "preserved"}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	latest, err := os.ReadFile(p.Path("state.json"))
	if err != nil {
		t.Fatal(err)
	}
	latest = append(latest, []byte("latest damaged tail")...)
	if err := os.WriteFile(p.Path("state.json"), latest, 0o644); err != nil {
		t.Fatal(err)
	}
	unlock()
	if err := h.svc.ConfigSet(context.Background(), []string{"TZ=UTC"}); err != nil {
		t.Fatal(err)
	}
	kept, err := os.ReadFile(p.Path("state.json.corrupt"))
	if err != nil || string(kept) != string(latest) {
		t.Fatalf("next mutation did not preserve the current damaged state: %q, %v", kept, err)
	}
	info, err := os.Stat(p.Path("state.json.corrupt"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("corruption copy must be private: %v, %v", info, err)
	}
	state, err = p.LoadState()
	if err != nil || state.Apps["one"].Inputs["concurrent"] != "preserved" {
		t.Fatalf("next mutation lost concurrent changes: %+v, %v", state, err)
	}
	current, err = os.ReadFile(p.Path("state.json"))
	if err != nil || !json.Valid(current) {
		t.Fatalf("next mutation left corrupt state: %q, %v", current, err)
	}
}
