package compose

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func collectPull(t *testing.T, dep *system.Deps) []events.Event {
	t.Helper()
	var got []events.Event
	log := events.New(events.SinkFunc(func(e events.Event) {
		if e.Event == events.PullProgress {
			got = append(got, e)
		}
	}))
	c := New(dep, log, t.TempDir(), "selfhost")
	if err := c.PullProgress(context.Background(), "a"); err != nil {
		t.Fatalf("PullProgress: %v", err)
	}
	return got
}

func TestPullProgressParsesLayersAndCompletes(t *testing.T) {
	data, err := os.ReadFile("testdata/pull.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	dep := systemtest.NewDeps(t)
	dep.Runner.(*systemtest.Runner).OnStream("--progress json pull", string(data))
	step := 0
	dep.Now = func() time.Time { step++; return time.Unix(0, 0).Add(time.Duration(step) * time.Second) }

	got := collectPull(t, dep)

	if len(got) == 0 || got[0].Image != "busybox:1.36.1" || got[0].Layer != "" || got[0].Status != "Pulling" {
		t.Fatalf("first event %+v", got)
	}
	var downloading *events.Event
	for i := range got {
		if got[i].Layer != "" && got[i].Status == "Downloading" {
			downloading = &got[i]
		}
	}
	if downloading == nil || downloading.Current != 32124 || downloading.Total != 1896265 {
		t.Fatalf("downloading event %+v", downloading)
	}
	last := got[len(got)-1]
	if last.Layer != "" || last.Status != "Pulled" {
		t.Fatalf("final event %+v", last)
	}
}

func TestPullProgressThrottlesButAlwaysCompletes(t *testing.T) {
	data, err := os.ReadFile("testdata/pull.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	dep := systemtest.NewDeps(t)
	dep.Runner.(*systemtest.Runner).OnStream("--progress json pull", string(data))
	dep.Now = func() time.Time { return time.Unix(0, 0) }

	got := collectPull(t, dep)

	if len(got) != 2 || got[0].Status != "Pulling" || got[1].Status != "Pulled" {
		t.Fatalf("throttled events %+v", got)
	}
}

func TestPullProgressFailureNamesTheImage(t *testing.T) {
	dep := systemtest.NewDeps(t)
	line := `{"id":"Image busybox:1.36.1","status":"Working","text":"Pulling"}` + "\n"
	dep.Runner.(*systemtest.Runner).OnStreamError("--progress json pull", line, errors.New("exit status 1"))
	log := events.New()
	c := New(dep, log, t.TempDir(), "selfhost")

	err := c.PullProgress(context.Background(), "a")

	var perr *PullError
	if !errors.As(err, &perr) || perr.Image != "busybox:1.36.1" {
		t.Fatalf("error %v (%+v)", err, perr)
	}
	if !strings.Contains(dep.Runner.(*systemtest.Runner).Calls()[0], "--progress json pull a") {
		t.Fatal("pull command not recorded")
	}
}
