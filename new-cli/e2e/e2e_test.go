//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
)

const defaultTargets = "ntfy vaultwarden media"

func TestE2E(t *testing.T) {
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
	t.Setenv("E2E_LOG_DIR", logDir)
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
	t.Logf("Evidence: %s (serial; maximum 12 App environments, global ceiling 20)", logDir)
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
	defer release()
	if _, err := os.Lstat(lockPath + ".blocked"); err == nil {
		t.Fatal("previous owned teardown failed; recover retained project before another sweep")
	}
	guard := &sweepGuard{ProjectNames: map[string]string{}}
	guard.OnBlock = func(project string) {
		data, _ := json.Marshal(struct {
			Project        string `json:"project"`
			ComposeProject string `json:"compose_project"`
		}{project, guard.ProjectNames[project]})
		if err := os.WriteFile(lockPath+".blocked", append(data, '\n'), 0o600); err != nil {
			t.Error("failed to persist teardown blocker")
		}
	}
	deadline, hasDeadline := t.Deadline()
	for _, spec := range selected {
		if !guard.CanRunNext() {
			t.Error("remaining targets not-run after owned teardown failure")
			break
		}
		if hasDeadline && time.Now().After(deadline.Add(-2*time.Minute)) {
			t.Error("deadline near; remaining inventory stays not-run")
			break
		}
		spec := spec
		t.Run(evidenceName(spec), func(t *testing.T) {
			r := newRunner(t, guard)
			r.spec = spec
			r.target = evidenceName(spec)
			r.evidence = newEvidence(spec, codeHead)
			r.evidence.BinarySHA256 = binarySHA
			r.evidence.Classification = classifyTarget(c, spec)
			r.saveEvidence()
			if r.evidence.Classification != "runnable" {
				r.evidence.Outcome = r.evidence.Classification
				r.saveEvidence()
				t.Skip(r.evidence.Classification)
			}
			if len(spec.Apps) > 20 {
				r.evidence.Outcome = "blocked"
				r.saveEvidence()
				t.Fatal("target exceeds global App environment ceiling")
			}
			reservation, err := reserveTargetPorts(c, spec)
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
