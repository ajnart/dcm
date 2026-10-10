package updatecheck

import (
	"context"
	"testing"
	"time"
)

type blockedNoticeCache struct {
	load func() State
	save func(State) error
}

func (c blockedNoticeCache) Load() State        { return c.load() }
func (c blockedNoticeCache) Save(s State) error { return c.save(s) }

func TestNoticeDeadlineSurvivesUncancellableLookupAndCache(t *testing.T) {
	for _, blocked := range []string{"lookup", "initial-load", "worker-load", "worker-save", "notice-save"} {
		t.Run(blocked, func(t *testing.T) {
			release := make(chan struct{})
			finished := make(chan struct{})
			workerFinished := make(chan struct{})
			returned := make(chan string, 1)
			now := time.Now()
			loads, saves := 0, 0
			cache := blockedNoticeCache{
				load: func() State {
					loads++
					if (blocked == "initial-load" && loads == 1) || (blocked == "worker-load" && loads == 2) {
						<-release
					}
					return State{}
				},
				save: func(State) error {
					saves++
					if (blocked == "worker-save" && saves == 1) || (blocked == "notice-save" && saves == 2) {
						<-release
					}
					if saves == 2 {
						close(workerFinished)
					}
					return nil
				},
			}
			lookup := func(context.Context) (string, error) {
				if blocked == "lookup" {
					<-release
				}
				return "1.1.0", nil
			}
			go func() {
				defer close(finished)
				returned <- startNotice("1.0.0", now, lookup, cache)()
			}()
			var timedOut bool
			select {
			case got := <-returned:
				if got != "" {
					t.Errorf("notice = %q", got)
				}
			case <-time.After(time.Second):
				timedOut = true
			}
			close(release)
			select {
			case <-workerFinished:
			case <-time.After(3 * time.Second):
				t.Fatal("test worker did not finish after releasing fake")
			}
			select {
			case <-finished:
			case <-time.After(3 * time.Second):
				t.Fatal("test caller did not terminate after releasing fake")
			}
			if timedOut {
				t.Fatal("completed command exceeded the bounded notice wait")
			}
		})
	}
}
