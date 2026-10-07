package project

import (
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/system"
)

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
				state.Apps[strings.Repeat("a", j+1)] = &AppState{Setup: "ok", Port: 8000 + j}
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

func TestDamagedStateIsRecoveredFromItsFirstValue(t *testing.T) {
	p := testProject(t)
	damaged := `{"version":1,"apps":{"ntfy":{"setup":"ok","port":2586}}}` + "\n" + `      "steps": {"x": 1}}`
	os.WriteFile(p.Path("state.json"), []byte(damaged), 0o644)

	state, err := p.LoadState()

	if err != nil || state.Apps["ntfy"] == nil || state.Apps["ntfy"].Port != 2586 {
		t.Fatalf("state %+v, err %v", state, err)
	}
	if kept, _ := os.ReadFile(p.Path("state.json.corrupt")); string(kept) != damaged {
		t.Fatal("the damaged file must be kept as state.json.corrupt")
	}
	if _, err := p.LoadState(); err != nil {
		t.Fatalf("state.json was not rewritten clean: %v", err)
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
