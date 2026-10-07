package e2e

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCommandFixtureProcess(t *testing.T) {
	if os.Getenv("SELFHOST_COMMAND_FIXTURE") != "1" {
		return
	}
	if sentinel := os.Getenv("SELFHOST_COMMAND_CHILD"); sentinel != "" {
		time.Sleep(600 * time.Millisecond)
		os.WriteFile(sentinel, []byte("late owned mutation"), 0o600)
		return
	}
	if sentinel := os.Getenv("SELFHOST_COMMAND_SPAWN"); sentinel != "" {
		child := exec.Command(os.Args[0], "-test.run=^TestCommandFixtureProcess$")
		child.Env = append(os.Environ(), "SELFHOST_COMMAND_CHILD="+sentinel)
		if child.Start() != nil {
			os.Exit(8)
		}
		os.WriteFile(os.Getenv("SELFHOST_COMMAND_READY"), []byte("ready"), 0o600)
		child.Wait()
		return
	}
	os.Stderr.WriteString("synthetic-private-stderr")
	if os.Getenv("SELFHOST_COMMAND_EXIT") == "7" {
		os.Exit(7)
	}
	if path := os.Getenv("SELFHOST_COMMAND_READY"); path != "" {
		os.WriteFile(path, []byte("ready"), 0o600)
	}
	time.Sleep(10 * time.Second)
}

func TestOrdinaryCommandExitIsNotAContextTermination(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	cmd := fixtureCommand(ctx, "")
	cmd.Env = append(cmd.Env, "SELFHOST_COMMAND_EXIT=7")
	res := executeOwnedCommand(ctx, cmd)
	if res.code != 7 || res.termination != nil {
		t.Fatal("ordinary command failure misclassified as timeout")
	}
}

func fixtureCommand(ctx context.Context, ready string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCommandFixtureProcess$")
	cmd.Env = append(os.Environ(), "SELFHOST_COMMAND_FIXTURE=1", "SELFHOST_COMMAND_READY="+ready, "GORACE=atexit_sleep_ms=0")
	return cmd
}

func TestCommandDeadlineRetainsSanitizedTermination(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	res := executeOwnedCommand(ctx, fixtureCommand(ctx, ""))
	if res.code != 124 || res.termination == nil || res.termination.Kind != "timeout" || !strings.Contains(res.stderr, "synthetic-private-stderr") {
		t.Fatal("real killed process lost its timeout diagnosis")
	}
	data, _ := json.Marshal(res.termination)
	if strings.Contains(string(data), "synthetic-private") || res.termination.Reason != "command deadline exceeded" {
		t.Fatal("private subprocess output entered timeout metadata")
	}
}

func TestCommandCancellationRetainsCleanupReserve(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := filepath.Join(t.TempDir(), "ready")
	done := make(chan result, 1)
	go func() { done <- executeOwnedCommand(ctx, fixtureCommand(ctx, ready)) }()
	limit := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(limit) {
			t.Fatal("synthetic command did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	select {
	case res := <-done:
		if res.code != 130 || res.termination == nil || res.termination.Kind != "canceled" || res.termination.Reason != "command canceled" {
			t.Fatal("actual subprocess cancellation was overwritten")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not free time for owned cleanup")
	}
}

func TestSeafileInstallBudgetIsBoundedBySweepDeadline(t *testing.T) {
	if installCommandLimit(targetSpec{Apps: []string{"seafile"}}) != 15*time.Minute || installCommandLimit(targetSpec{Apps: []string{"ntfy"}}) != 10*time.Minute {
		t.Fatal("focused slow-install window missing or widened unrelated targets")
	}
	deadline := time.Now().Add(20 * time.Minute)
	parent, cancel := sweepCommandContext(deadline, true)
	defer cancel()
	child, stop := context.WithTimeout(parent, 15*time.Minute)
	defer stop()
	got, _ := child.Deadline()
	if !got.Equal(deadline.Add(-12 * time.Minute)) {
		t.Fatal("install extension consumed the cleanup reserve")
	}
}

func TestCancellationKillsSpawnedOwnedMutation(t *testing.T) {
	for _, cancelEarly := range []bool{false, true} {
		root := t.TempDir()
		ready, sentinel := filepath.Join(root, "ready"), filepath.Join(root, "sentinel")
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := fixtureCommand(ctx, ready)
		cmd.Env = append(cmd.Env, "SELFHOST_COMMAND_SPAWN="+sentinel)
		done := make(chan result, 1)
		go func() { done <- executeOwnedCommand(ctx, cmd) }()
		limit := time.Now().Add(time.Second)
		for {
			if _, err := os.Stat(ready); err == nil {
				break
			}
			if time.Now().After(limit) {
				cancel()
				t.Fatal("owned child fixture did not start")
			}
			time.Sleep(5 * time.Millisecond)
		}
		if cancelEarly {
			cancel()
		}
		res := <-done
		cancel()
		if cancelEarly {
			if res.code != 130 {
				t.Fatal("canceled parent lost context outcome")
			}
			time.Sleep(750 * time.Millisecond)
			if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
				t.Fatal("spawned child survived cancellation and mutated owned sentinel")
			}
		} else if res.code != 0 {
			t.Fatal("positive control command failed")
		} else if _, err := os.Stat(sentinel); err != nil {
			t.Fatal("positive control child did not perform owned mutation")
		}
	}
}

func TestInsufficientTestTimeoutHasActionableFailure(t *testing.T) {
	if err := sweepBudgetError(time.Now().Add(10*time.Minute), true); err == nil || !strings.Contains(err.Error(), "-timeout") {
		t.Fatal("default ten-minute budget silently expires before runtime")
	}
	if err := sweepBudgetError(time.Now().Add(20*time.Minute), true); err != nil {
		t.Fatal("adequate budget rejected")
	}
	if err := sweepBudgetError(time.Time{}, false); err != nil {
		t.Fatal("explicit timeout-disabled invocation rejected")
	}
}
