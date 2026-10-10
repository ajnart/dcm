package service_test

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type updatePanicRunner struct {
	started chan struct{}
	stopped chan struct{}
}

func (r updatePanicRunner) Run(ctx context.Context, cmd system.Cmd) (system.Result, error) {
	if cmd.Args[len(cmd.Args)-1] == "waiting:latest" {
		close(r.started)
		<-ctx.Done()
		close(r.stopped)
		return system.Result{}, ctx.Err()
	}
	<-r.started
	panic("synthetic update worker panic")
}

func (updatePanicRunner) Stream(context.Context, system.Cmd, io.Writer) error { return nil }

func TestCheckUpdatesCancelsAndJoinsWorkersBeforePropagatingPanic(t *testing.T) {
	deps := systemtest.NewDeps(t)
	runner := updatePanicRunner{started: make(chan struct{}), stopped: make(chan struct{})}
	deps.Runner = runner
	svc := service.New(deps, events.Discard(), nil)
	status := service.Status{Apps: []service.AppStatus{{ID: "one", Image: "panic:latest"}, {ID: "two", Image: "waiting:latest"}}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var recovered any
	func() {
		defer func() { recovered = recover() }()
		svc.CheckUpdates(ctx, &status)
	}()
	crash, ok := recovered.(system.CapturedPanic)
	if !ok || crash.Value != "synthetic update worker panic" || len(crash.Stack) == 0 {
		t.Fatalf("panic was lost or reclassified: %v", recovered)
	}
	if ctx.Err() != nil {
		t.Fatal("workers only terminated at the outer deadline")
	}
	select {
	case <-runner.stopped:
	default:
		t.Fatal("a worker was left running after panic propagation")
	}
}
