package e2e

import (
	"context"
	"fmt"
	"github.com/ajnart/self-host/internal/catalog"
	"sync"
	"testing"
	"time"
)

func TestSchedulerAcquiresWholeAppBudget(t *testing.T) {
	g := newSweepGuard(4)
	first, err := g.acquire(context.Background(), 12, false)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if lease, err := g.acquire(ctx, 9, false); err == nil {
		lease.finish(true)
		t.Fatal("exceeded 20 App environments")
	}
	if jobs, apps := g.capacity(); jobs != 1 || apps != 12 {
		t.Fatalf("partial capacity retained: %d jobs, %d Apps", jobs, apps)
	}
	second, err := g.acquire(context.Background(), 8, false)
	if err != nil {
		t.Fatal(err)
	}
	second.finish(true)
	first.finish(true)
	if jobs, apps := g.capacity(); jobs != 0 || apps != 0 {
		t.Fatal("successful cleanup did not release capacity")
	}
}

func TestTeardownFailureBlocksQueuedAdmissionAndRetainsBudget(t *testing.T) {
	g := newSweepGuard(1)
	active, err := g.acquire(context.Background(), 3, false)
	if err != nil {
		t.Fatal(err)
	}
	queued := make(chan error, 1)
	go func() {
		lease, err := g.acquire(context.Background(), 1, false)
		if lease != nil {
			lease.finish(true)
		}
		queued <- err
	}()
	g.Block("/tmp/retained-project")
	active.finish(false)
	select {
	case err := <-queued:
		if err == nil {
			t.Fatal("queued target started after failed teardown")
		}
	case <-time.After(time.Second):
		t.Fatal("queued target did not observe blocker")
	}
	if jobs, apps := g.capacity(); jobs != 1 || apps != 3 {
		t.Fatal("failed teardown released capacity")
	}
}

func TestSchedulerRespectsWorkerLimitAndExclusiveTargets(t *testing.T) {
	g := newSweepGuard(2)
	one, _ := g.acquire(context.Background(), 1, false)
	two, _ := g.acquire(context.Background(), 1, false)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if lease, err := g.acquire(ctx, 1, false); err == nil {
		lease.finish(true)
		t.Fatal("worker ceiling exceeded")
	}
	exclusive := make(chan *targetLease, 1)
	go func() { lease, _ := g.acquire(context.Background(), 6, true); exclusive <- lease }()
	one.finish(true)
	select {
	case <-exclusive:
		t.Fatal("exclusive target started beside an active target")
	case <-time.After(20 * time.Millisecond):
	}
	two.finish(true)
	var heavy *targetLease
	select {
	case heavy = <-exclusive:
		if heavy == nil {
			t.Fatal("exclusive acquire failed")
		}
	case <-time.After(time.Second):
		t.Fatal("exclusive target deadlocked")
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel2()
	if lease, err := g.acquire(ctx2, 1, false); err == nil {
		lease.finish(true)
		t.Fatal("light target overlapped exclusive target")
	}
	heavy.finish(true)
}

func TestConcurrentTeardownRetainsEveryOwnedProject(t *testing.T) {
	g := newSweepGuard(4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			path := fmt.Sprintf("/tmp/project-%d", i)
			g.RegisterProject(path, fmt.Sprintf("owned-%d", i))
			g.Block(path)
		}(i)
	}
	wg.Wait()
	if len(g.RetainedProjects()) != 4 {
		t.Fatal("concurrent teardown lost a retained Project")
	}
	for _, project := range g.RetainedProjects() {
		if project.ComposeProject == "" {
			t.Fatal("recovery Compose name missing")
		}
	}
}

func TestHeavyRecipesAndSecondaryPortsAreExclusive(t *testing.T) {
	c := catalog.Default()
	inventory := acceptanceInventory(c)
	for _, tc := range []struct {
		id        string
		exclusive bool
	}{{"ntfy", false}, {"vaultwarden", false}, {"bookstack", true}, {"media", true}, {"qbittorrent", true}, {"pihole", true}, {"ollama", true}} {
		if got := exclusiveTarget(c, findTarget(inventory, tc.id)); got != tc.exclusive {
			t.Errorf("%s: exclusive=%v", tc.id, got)
		}
	}
}
