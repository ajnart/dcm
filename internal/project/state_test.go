package project

import (
	"encoding/json"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/system"
)

func TestStateRecoveryRereadsCurrentDamageUnderLock(t *testing.T) {
	p := testProject(t)
	first := `{"version":1,"apps":{"ntfy":{"setup":"ok","port":2586}}} trailing`
	if err := os.WriteFile(p.Path("state.json"), []byte(first), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := p.LoadState(); err != nil {
		t.Fatal(err)
	}
	// A writer replaced the reader's original snapshot before repair acquired
	// ownership. Repair must preserve and recover this newer snapshot.
	latest := `{"version":1,"apps":{"ntfy":{"setup":"ok","port":9000},"gatus":{"setup":"pending"}}} latest tail`
	unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err := os.WriteFile(p.Path("state.json"), []byte(latest), 0o644); err != nil {
		t.Fatal(err)
	}
	// Existing broad permissions must also be corrected when keeping a copy.
	if err := os.WriteFile(p.Path("state.json.corrupt"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := p.RecoverState(); err != nil {
		t.Fatal(err)
	}
	state, err := p.LoadState()
	if err != nil || state.Apps["ntfy"].Port != 9000 || state.Apps["gatus"] == nil {
		t.Fatalf("recovery lost the latest writer's state: %+v, %v", state, err)
	}
	kept, err := os.ReadFile(p.Path("state.json.corrupt"))
	if err != nil || string(kept) != latest {
		t.Fatalf("recovery kept the wrong damaged bytes: %q, %v", kept, err)
	}
	info, err := os.Stat(p.Path("state.json.corrupt"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("corruption copy must be private: %v, %v", info, err)
	}
	current, err := os.ReadFile(p.Path("state.json"))
	if err != nil || !json.Valid(current) {
		t.Fatalf("recovery did not persist clean state: %q, %v", current, err)
	}
}

func testProject(t *testing.T) *Project {
	t.Helper()
	return &Project{Root: t.TempDir(), Owner: system.User{UID: os.Getuid(), GID: os.Getgid()}, ComposeName: Name}
}

// Two writers used to share state.json.tmp and leave a damaged file.
func TestConcurrentSavesNeverDamageState(t *testing.T) {
	p := testProject(t)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			state := &State{Version: 1, Apps: map[string]*AppState{}}
			for j := 0; j <= i%7; j++ {
				state.Apps[strings.Repeat("a", j+1)] = &AppState{Setup: stepstatus.SetupOK, Port: 8000 + j}
			}
			if err := p.SaveState(state); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	if _, err := p.LoadState(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p.Path("state.json.corrupt")); err == nil {
		t.Fatal("concurrent saves damaged state.json")
	}
}

func TestDamagedStateReadSalvagesWithoutWriting(t *testing.T) {
	p := testProject(t)
	damaged := `{"version":1,"apps":{"ntfy":{"setup":"ok","port":2586}}}` + "\n" + `      "steps": {"x": 1}}`
	os.WriteFile(p.Path("state.json"), []byte(damaged), 0o644)
	os.WriteFile(p.Path("state.json.corrupt"), []byte("previous corruption"), 0o600)

	state, err := p.LoadState()

	if err != nil || state.Apps["ntfy"] == nil || state.Apps["ntfy"].Port != 2586 {
		t.Fatalf("state %+v, err %v", state, err)
	}
	if current, _ := os.ReadFile(p.Path("state.json")); string(current) != damaged {
		t.Fatal("reading salvageable state rewrote state.json")
	}
	if kept, _ := os.ReadFile(p.Path("state.json.corrupt")); string(kept) != "previous corruption" {
		t.Fatal("reading salvageable state replaced the previous corruption copy")
	}
}

func TestUnrecoverableStateReadDoesNotClaimOrWriteCopy(t *testing.T) {
	p := testProject(t)
	damaged := []byte(`{"version":1,"apps":`)
	if err := os.WriteFile(p.Path("state.json"), damaged, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := p.LoadState()
	if err == nil || strings.Contains(err.Error(), "copy") || !strings.Contains(err.Error(), "restore state.json") || !strings.Contains(err.Error(), "self-host setup") {
		t.Fatalf("reader must provide recovery instructions without claiming a copy: %v", err)
	}
	if _, err := os.Stat(p.Path("state.json.corrupt")); !os.IsNotExist(err) {
		t.Fatalf("read-only error created a corruption copy: %v", err)
	}
	unlock, err := p.Lock(os.Getpid(), func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err := p.RecoverState(); err == nil {
		t.Fatal("unrecoverable state must block the mutation")
	}
	kept, err := os.ReadFile(p.Path("state.json.corrupt"))
	if err != nil || string(kept) != string(damaged) {
		t.Fatalf("failed mutation must preserve the actual corruption: %q, %v", kept, err)
	}
	current, err := os.ReadFile(p.Path("state.json"))
	if err != nil || string(current) != string(damaged) {
		t.Fatalf("unrecoverable state must not be replaced: %q, %v", current, err)
	}
}

func TestLockSerialisesMutationsOfOneProcess(t *testing.T) {
	p := testProject(t)
	alive := func(int) bool { return true }
	unlock, err := p.Lock(42, alive)
	if err != nil {
		t.Fatal(err)
	}
	second := make(chan struct{})
	go func() {
		unlock2, err := p.Lock(42, alive)
		if err == nil {
			unlock2()
		}
		close(second)
	}()
	select {
	case <-second:
		t.Fatal("a second mutation of the same process must wait")
	default:
	}
	unlock()
	<-second
}

func TestLockRefusesAnotherLiveProcess(t *testing.T) {
	p := testProject(t)
	os.WriteFile(p.Path(".lock"), []byte("777"), 0o644)

	if _, err := p.Lock(42, func(pid int) bool { return pid == 777 }); err == nil {
		t.Fatal("a lock held by another live process must be refused")
	}
	unlock, err := p.Lock(42, func(int) bool { return false })
	if err != nil {
		t.Fatalf("a stale lock must be replaced: %v", err)
	}
	unlock()
}

func TestLegacyStatusStringsRoundTrip(t *testing.T) {
	p := testProject(t)
	legacy := []byte(`{"version":1,"apps":{"ok":{"port":0,"setup":"ok","steps":{"ok":{"status":"ok"},"skip":{"status":"skip"},"fail":{"status":"fail"},"manual":{"status":"manual"}}},"incomplete":{"port":0,"setup":"incomplete"},"manual":{"port":0,"setup":"manual"},"pending":{"port":0,"setup":"pending"},"unmanaged":{"port":0,"setup":"unmanaged"}}}`)
	if err := os.WriteFile(p.Path("state.json"), legacy, 0o644); err != nil {
		t.Fatal(err)
	}
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(p.Path("state.json"))
	if err != nil {
		t.Fatal(err)
	}
	statusFields := func(data []byte) map[string]string {
		var doc struct {
			Apps map[string]struct {
				Setup json.RawMessage
				Steps map[string]struct{ Status json.RawMessage }
			}
		}
		if err := json.Unmarshal(data, &doc); err != nil {
			t.Fatal(err)
		}
		fields := map[string]string{}
		for id, app := range doc.Apps {
			fields[id+"/setup"] = string(app.Setup)
			for step, record := range app.Steps {
				fields[id+"/"+step] = string(record.Status)
			}
		}
		return fields
	}
	if !reflect.DeepEqual(statusFields(got), statusFields(legacy)) {
		t.Fatalf("legacy status bytes changed: %s", got)
	}
	if typ := reflect.TypeOf(state.Apps["ok"].Steps["ok"].Status); typ.Name() != "Step" {
		t.Fatalf("step status type = %s, want status.Step", typ)
	}
	if typ := reflect.TypeOf(state.Apps["ok"].Setup); typ.Name() != "Setup" {
		t.Fatalf("Setup type = %s, want status.Setup", typ)
	}
}
