package updatecheck

import (
	"context"
	"sync"
	"testing"
	"time"
)

type noticeStateCache struct {
	mu          sync.Mutex
	state       State
	loadBarrier func(int)
	saveBarrier func(int)
	loads       int
	saves       int
}

func (c *noticeStateCache) Load() State {
	c.mu.Lock()
	c.loads++
	n := c.loads
	c.mu.Unlock()
	if c.loadBarrier != nil {
		c.loadBarrier(n)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

func (c *noticeStateCache) Save(s State) error {
	c.mu.Lock()
	c.saves++
	n := c.saves
	c.mu.Unlock()
	if c.saveBarrier != nil {
		c.saveBarrier(n)
	}
	c.mu.Lock()
	c.state = s
	c.mu.Unlock()
	return nil
}

func waitNoticeWorker(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("notice worker did not finish after releasing fake")
	}
}

func TestTimedOutNoticeDoesNotAcknowledgeLateLookupOrCacheWrites(t *testing.T) {
	for _, blocked := range []string{"lookup", "initial-load", "worker-load", "latest-save"} {
		t.Run(blocked, func(t *testing.T) {
			release := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			cache := &noticeStateCache{}
			cache.loadBarrier = func(n int) {
				if (blocked == "initial-load" && n == 1) || (blocked == "worker-load" && n == 2) {
					<-release
				}
			}
			cache.saveBarrier = func(n int) {
				if blocked == "latest-save" && n == 1 {
					<-release
				}
			}
			lookup := func(context.Context) (string, error) {
				if blocked == "lookup" {
					<-release
				}
				return "1.1.0", nil
			}
			now := time.Now()
			notice, done := startNoticeWorker("1.0.0", now, lookup, cache)
			t.Cleanup(func() { unblock(); waitNoticeWorker(t, done) })
			if got := notice(); got != "" {
				t.Fatalf("timed-out notice = %q", got)
			}
			unblock()
			waitNoticeWorker(t, done)
			state := cache.Load()
			if !state.NoticedAt.IsZero() || state.Latest != "1.1.0" || !state.CheckedAt.Equal(now) {
				t.Fatalf("late cache write consumed an unannounced notice: %+v", state)
			}
			fast, fastDone := startNoticeWorker("1.0.0", now, func(context.Context) (string, error) {
				t.Error("cached Latest triggered another lookup")
				return "", nil
			}, cache)
			if got := fast(); got != Notice("1.1.0") {
				t.Fatalf("unannounced cached release was suppressed: %q", got)
			}
			waitNoticeWorker(t, fastDone)
			if got := cache.Load().NoticedAt; !got.Equal(now) {
				t.Fatalf("accepted notice was not marked: %v", got)
			}
			again, againDone := startNoticeWorker("1.0.0", now, lookup, cache)
			if got := again(); got != "" {
				t.Fatalf("accepted notice was repeated: %q", got)
			}
			waitNoticeWorker(t, againDone)
		})
	}
}

func TestAcceptedNoticeAcknowledgementStaysBoundedDuringCacheSave(t *testing.T) {
	for _, cached := range []bool{false, true} {
		t.Run(map[bool]string{false: "lookup", true: "cached"}[cached], func(t *testing.T) {
			now := time.Now()
			release := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			cache := &noticeStateCache{}
			ackSave := 2
			if cached {
				cache.state = State{Latest: "1.1.0", CheckedAt: now}
				ackSave = 1
			}
			cache.saveBarrier = func(n int) {
				if n == ackSave {
					<-release
				}
			}
			lookup := func(context.Context) (string, error) { return "1.1.0", nil }
			notice, done := startNoticeWorker("1.0.0", now, lookup, cache)
			t.Cleanup(func() { unblock(); waitNoticeWorker(t, done) })
			started := time.Now()
			if got := notice(); got != Notice("1.1.0") || time.Since(started) > time.Second {
				t.Fatalf("accepted notice %q after %v", got, time.Since(started))
			}
			if !cache.Load().NoticedAt.IsZero() {
				t.Fatal("blocked acknowledgement was prematurely persisted")
			}
			unblock()
			waitNoticeWorker(t, done)
			if !cache.Load().NoticedAt.Equal(now) {
				t.Fatal("accepted notice acknowledgement was lost")
			}
			again, againDone := startNoticeWorker("1.0.0", now, lookup, cache)
			if got := again(); got != "" {
				t.Fatalf("accepted notice was repeated: %q", got)
			}
			waitNoticeWorker(t, againDone)
		})
	}
}

func TestCompletedNoticeSurvivesLookupDeadlineUntilAcceptedOrAbandoned(t *testing.T) {
	for _, accept := range []bool{true, false} {
		t.Run(map[bool]string{true: "accepted", false: "abandoned"}[accept], func(t *testing.T) {
			lifecycle, abandon := context.WithCancel(context.Background())
			defer abandon()
			cache := &noticeStateCache{}
			lookupContext := make(chan context.Context, 1)
			now := time.Now()
			notice, done := startNoticeWorkerContext(lifecycle, "1.0.0", now, func(ctx context.Context) (string, error) {
				lookupContext <- ctx
				return "1.1.0", nil
			}, cache)
			t.Cleanup(func() { abandon(); waitNoticeWorker(t, done) })
			ctx := <-lookupContext
			<-ctx.Done()
			select {
			case <-done:
				t.Fatal("completed offer stopped awaiting acceptance at lookup deadline")
			default:
			}
			if accept {
				if got := notice(); got != Notice("1.1.0") {
					t.Fatalf("completed offer was lost after lookup deadline: %q", got)
				}
				waitNoticeWorker(t, done)
				if !cache.Load().NoticedAt.Equal(now) {
					t.Fatal("delayed accepted notice was not acknowledged")
				}
				again, againDone := startNoticeWorker("1.0.0", now, func(context.Context) (string, error) {
					t.Error("cached release triggered a lookup")
					return "", nil
				}, cache)
				if got := again(); got != "" {
					t.Fatalf("delayed accepted notice was repeated: %q", got)
				}
				waitNoticeWorker(t, againDone)
			} else {
				abandon()
				waitNoticeWorker(t, done)
				if !cache.Load().NoticedAt.IsZero() {
					t.Fatal("abandoned notice was acknowledged")
				}
				started := time.Now()
				if got := notice(); got != "" || time.Since(started) > 100*time.Millisecond {
					t.Fatalf("abandoned callback returned %q after %v", got, time.Since(started))
				}
			}
		})
	}
}
