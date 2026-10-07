//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
)

const defaultTargets = "ntfy vaultwarden media"

func TestE2E(t *testing.T) {
	workers := 1
	if value := os.Getenv("E2E_PARALLEL"); value != "" {
		var err error
		workers, err = strconv.Atoi(value)
		if err != nil || workers < 1 || workers > 4 {
			t.Fatal("E2E_PARALLEL must be 1 through 4")
		}
	}
	if workers > 1 && os.Getenv("E2E_LOG_DIR") == "" {
		t.Fatal("parallel acceptance requires explicit E2E_LOG_DIR")
	}
	c := catalog.Default()
	inventory := acceptanceInventory(c)
	logDir := os.Getenv("E2E_LOG_DIR")
	if logDir == "" {
		var err error
		logDir, err = os.MkdirTemp("", "selfhost-e2e-evidence-")
		if err != nil {
			t.Fatal("create evidence directory")
		}
	}
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		t.Fatal("create evidence directory")
	}
	data, _ := json.MarshalIndent(inventory, "", "  ")
	if err := os.WriteFile(filepath.Join(logDir, "inventory.json"), append(data, '\n'), 0o600); err != nil {
		t.Fatal("write inventory")
	}
	for _, spec := range inventory {
		e := newEvidence(spec, codeHead)
		e.Classification = classifyTarget(c, spec)
		if err := initializeEvidence(logDir, e); err != nil {
			t.Fatal("initialize evidence")
		}
	}
	t.Logf("Evidence: %s (workers=%d, global App environment ceiling 20; heavy targets exclusive)", logDir, workers)
	ids := strings.Fields(os.Getenv("E2E_TARGETS"))
	if len(ids) == 0 {
		ids = strings.Fields(defaultTargets)
	}
	var selected []targetSpec
	if len(ids) == 1 && ids[0] == "all" {
		selected = inventory
	} else {
		seen := map[string]bool{}
		for _, id := range ids {
			spec := findTarget(inventory, id)
			if spec.ID == "" {
				t.Fatalf("unknown catalog target %q", id)
			}
			if !seen[evidenceName(spec)] {
				selected = append(selected, spec)
				seen[evidenceName(spec)] = true
			}
		}
	}
	if !dockerAvailable {
		for _, spec := range selected {
			e := newEvidence(spec, codeHead)
			e.Outcome = "blocked"
			e.Classification = "docker-unavailable"
			writeInitialEvidence(logDir, e)
		}
		t.Skip("Docker unavailable: selected targets recorded blocked, no runtime pass")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	lockPath := filepath.Join(os.TempDir(), "selfhost-e2e-global.lock")
	release, err := acquireGlobal(ctx, lockPath)
	if err != nil {
		t.Fatal("global serial slot unavailable")
	}
	t.Cleanup(release)
	if _, err := os.Lstat(lockPath + ".blocked"); err == nil {
		t.Fatal("previous owned teardown failed; recover retained project before another sweep")
	}
	guard := newSweepGuard(workers)
	guard.OnBlock = func(project string) {
		data, _ := json.Marshal(struct {
			Project          string            `json:"project"`
			ComposeProject   string            `json:"compose_project"`
			RetainedProjects []retainedProject `json:"retained_projects"`
		}{project, guard.ProjectName(project), guard.RetainedProjects()})
		if err := os.WriteFile(lockPath+".blocked", append(data, '\n'), 0o600); err != nil {
			t.Error("failed to persist teardown blocker")
		}
	}
	deadline, hasDeadline := t.Deadline()
	runCtx := context.Background()
	runCancel := func() {}
	if hasDeadline {
		runCtx, runCancel = context.WithDeadline(runCtx, deadline.Add(-2*time.Minute))
	}
	t.Cleanup(runCancel)
	for _, spec := range selected {
		spec := spec
		t.Run(evidenceName(spec), func(t *testing.T) {
			if workers > 1 {
				t.Parallel()
			}
			evidence := newEvidence(spec, codeHead)
			evidence.BinarySHA256 = binarySHA
			evidence.Classification = classifyTarget(c, spec)
			if evidence.Classification != "runnable" {
				evidence.Outcome = evidence.Classification
				if writeInitialEvidence(logDir, evidence) != nil {
					t.Fatal("write classified evidence")
				}
				t.Skip(evidence.Classification)
			}
			lease, err := guard.acquire(runCtx, len(spec.Apps), exclusiveTarget(c, spec))
			if err != nil {
				evidence.Outcome = "blocked"
				evidence.Classification = "capacity-or-teardown-blocked"
				writeInitialEvidence(logDir, evidence)
				t.Skip("target not started: capacity deadline or owned teardown blocker")
			}
			var r *runner
			var reservation *portReservation
			// Registered before runner cleanup: LIFO cleanup releases the whole target
			// only after both source and restore have actually been torn down.
			t.Cleanup(func() {
				clean := r == nil || (r.teardownOK && (r.restored == nil || r.restored.teardownOK))
				if clean && reservation != nil {
					reservation.release()
				}
				lease.finish(clean)
			})
			r = newRunner(t, guard, logDir)
			r.spec = spec
			r.target = evidenceName(spec)
			r.evidence = evidence
			r.saveEvidence()
			reservation, err = reserveTargetPorts(c, spec, guard.ports)
			if err != nil {
				r.evidence.Outcome = "blocked"
				r.saveEvidence()
				t.Skip("required published ports unavailable or isolation unsupported")
			}
			r.verify(spec, reservation)
		})
	}

}

func writeInitialEvidence(dir string, e *targetEvidence) error {
	data, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, evidenceName(e.Target)+".json"), append(data, '\n'), 0o600)
}

func initializeEvidence(dir string, e *targetEvidence) error {
	data, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, evidenceName(e.Target)+".json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if os.IsExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(data, '\n'))
	return err
}
