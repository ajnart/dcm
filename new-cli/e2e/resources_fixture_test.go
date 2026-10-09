package e2e

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestLocalDiskAdmissionUsesOwnedFilesystemAndFixedReasons(t *testing.T) {
	for _, tc := range []struct {
		name          string
		bytes, inodes uint64
		failure       bool
	}{
		{"adequate", 9 << 30, 200000, false},
		{"low bytes", 2 << 30, 200000, true},
		{"low inodes", 9 << 30, 100, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			obs := measureLocalAdmission("/owned/root", 8<<30, func(path string) (filesystemCapacity, error) {
				if path != "/owned/root" {
					t.Fatal("measured another filesystem")
				}
				return filesystemCapacity{AvailableBytes: tc.bytes, FreeInodes: tc.inodes}, nil
			})
			if (obs.Reason != "") != tc.failure || !obs.Measured || obs.AvailableBytes != tc.bytes {
				t.Fatal("resource admission misclassified")
			}
		})
	}
	obs := measureLocalAdmission("/owned/root", 8<<30, func(string) (filesystemCapacity, error) {
		return filesystemCapacity{}, errors.New("private path or device")
	})
	if obs.Measured || obs.Reason == "" || strings.Contains(obs.Reason, "private") {
		t.Fatal("measurement failure was not safely fail-closed")
	}
}

func TestLocalDiskBlockStopsQueuedAdmissionButAllowsScopedCleanup(t *testing.T) {
	guard := newSweepGuard(1)
	lease, err := guard.acquire(context.Background(), 1, false)
	if err != nil {
		t.Fatal(err)
	}
	queuedCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	queued := make(chan error, 1)
	go func() { _, err := guard.acquire(queuedCtx, 1, false); queued <- err }()
	time.Sleep(10 * time.Millisecond)
	guard.blockLocalResources(resourceEvidence{Reason: "local disk free bytes below configured floor"})
	if err := <-queued; safeBlockerReason(err) != "local disk free bytes below configured floor" {
		t.Fatal("queued target started or lost disk blocker")
	}
	down, removed := false, false
	if err := cleanupOwned(func() error { down = true; return nil }, func() { removed = true }, guard, "/owned/root"); err != nil || !down || !removed || guard.Retains("/owned/root") {
		t.Fatal("disk blocker prevented owned cleanup or fabricated teardown failure")
	}
	lease.finish(true)
	if jobs, apps := guard.capacity(); jobs != 0 || apps != 0 {
		t.Fatal("successful disk-blocked cleanup retained active capacity")
	}
}

func TestLocalDiskFloorConfigurationIsPositiveAndBounded(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  uint64
		valid bool
	}{{"", 8 << 30, true}, {"12", 12 << 30, true}, {"0", 0, false}, {"-1", 0, false}, {"private-value", 0, false}, {"18446744073709551615", 0, false}} {
		got, err := minimumFreeBytes(tc.value)
		if (err == nil) != tc.valid || got != tc.want {
			t.Fatal("invalid or overflowing disk floor accepted")
		}
		if err != nil && strings.Contains(err.Error(), tc.value) {
			t.Fatal("invalid configuration payload entered diagnostic")
		}
	}
}

func TestLocalDiskEvidencePreservesCompletedAndUnrunStages(t *testing.T) {
	e := newEvidence(targetSpec{Apps: []string{"ntfy"}}, "fixture")
	e.Stages[0].Outcome = "pass"
	e.Stages[1].Outcome = "running"
	obs := measureLocalAdmission("/owned/root", 8<<30, func(string) (filesystemCapacity, error) {
		return filesystemCapacity{AvailableBytes: 2 << 30, FreeInodes: 200000}, nil
	})
	markResourceBlocked(e, &obs)
	if e.complete() || e.Outcome != "blocked" || e.Classification != "local-disk-blocked" || e.Stages[0].Outcome != "pass" || e.Stages[1].Outcome != "blocked" || e.Stages[2].Outcome != "not-run" || e.Stages[1].Resources.AvailableBytes != 2<<30 {
		t.Fatal("resource blocker fabricated runtime acceptance or discarded earlier evidence")
	}
	for _, command := range []string{"install", "update", "restore", "backup", "setup"} {
		if !diskMutatingCommand([]string{command}) {
			t.Fatal("mutating command bypasses disk admission")
		}
	}
	for _, command := range []string{"stop", "credentials", "status"} {
		if diskMutatingCommand([]string{command}) {
			t.Fatal("read-only or cleanup command blocked by admission")
		}
	}
}
