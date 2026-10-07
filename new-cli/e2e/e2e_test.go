//go:build e2e

package e2e

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

const defaultTargets = "ntfy vaultwarden media"

func TestE2E(t *testing.T) {
	targets := strings.Fields(os.Getenv("E2E_TARGETS"))
	if len(targets) == 0 {
		targets = strings.Fields(defaultTargets)
	}
	if len(targets) == 1 && targets[0] == "all" {
		runCatalog(t)
		return
	}
	for _, target := range targets {
		target := target
		t.Run(target, func(t *testing.T) {
			r := newRunner(t)
			if r.verify(target) {
				t.Skipf("%s needs a web UI to create its first administrator; not a failure", target)
			}
		})
	}
}

type appsDoc struct {
	Apps []appJSON `json:"apps"`
}

type appJSON struct {
	ID     string      `json:"id"`
	Inputs []inputJSON `json:"inputs"`
}

type inputJSON struct {
	Key      string `json:"key"`
	Default  string `json:"default"`
	Required bool   `json:"required"`
}

func needsInput(app appJSON) bool {
	for _, in := range app.Inputs {
		if in.Required && in.Default == "" {
			return true
		}
	}
	return false
}

func runCatalog(t *testing.T) {
	discover := newRunner(t)
	res := discover.run("apps", "list", "--json")
	if res.code != 0 {
		t.Fatalf("apps list exit %d\n%s", res.code, res.stderr)
	}
	var doc appsDoc
	if err := json.Unmarshal([]byte(res.stdout), &doc); err != nil {
		t.Fatalf("apps list json: %v\n%s", err, res.stdout)
	}

	deadline, hasDeadline := t.Deadline()
	var passed, failed, manual, skipped []string
	for _, app := range doc.Apps {
		if hasDeadline && time.Now().After(deadline.Add(-2*time.Minute)) {
			t.Errorf("stopping early: test deadline %s is near", deadline)
			break
		}
		if needsInput(app) {
			skipped = append(skipped, app.ID)
			t.Logf("skipping %s: required input without default", app.ID)
			continue
		}
		isManual := false
		ok := t.Run(app.ID, func(t *testing.T) {
			r := newRunner(t)
			isManual = r.verify(app.ID)
			if isManual {
				t.Skipf("%s needs a web UI to create its first administrator; not a failure", app.ID)
			}
		})
		switch {
		case isManual:
			manual = append(manual, app.ID)
		case ok:
			passed = append(passed, app.ID)
		default:
			failed = append(failed, app.ID)
		}
	}
	if len(failed) > 0 {
		t.Errorf("catalog summary: passed=%d failed=%d manual=%d skipped=%d failed_ids=%v manual_ids=%v skipped_ids=%v",
			len(passed), len(failed), len(manual), len(skipped), failed, manual, skipped)
		return
	}
	t.Logf("catalog summary: passed=%d failed=%d manual=%d skipped=%d manual_ids=%v skipped_ids=%v",
		len(passed), len(failed), len(manual), len(skipped), manual, skipped)
}
