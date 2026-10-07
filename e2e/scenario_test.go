//go:build e2e

package e2e

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	statusWait = 3 * time.Minute
	statusPoll = 5 * time.Second
)

type statusDoc struct {
	Project string      `json:"project"`
	Apps    []statusApp `json:"apps"`
}

type statusApp struct {
	ID     string `json:"id"`
	State  string `json:"state"`
	Health string `json:"health"`
	Setup  string `json:"setup"`
}

func (r *runner) verify(target string) {
	r.t.Helper()
	r.target = sanitize(target)

	media := filepath.Join(r.root, "media")
	downloads := filepath.Join(r.root, "downloads")

	install := r.run("install", target, "--yes", "--json", "--media-root", media, "--downloads-root", downloads)
	switch {
	case install.code == exitIncomplete:
		r.t.Fatalf("install %s incomplete (exit 2):%s", target, formatFailures(install))
	case install.code != 0:
		r.t.Fatalf("install %s exit %d\nstdout:\n%s\nstderr:\n%s", target, install.code, install.stdout, install.stderr)
	}

	r.waitRunning(statusWait)

	setup := r.run("setup", "--json")
	if setup.code != 0 {
		r.t.Fatalf("setup run 2 exit %d%s", setup.code, formatFailures(setup))
	}
	for _, e := range setup.events {
		if e.Event == "step.fail" {
			r.t.Fatalf("setup run 2 failed: app=%s step=%s error=%s hint=%s", e.App, e.Step, e.Error, e.Hint)
		}
	}
	for _, e := range setup.events {
		if e.Event == "step.ok" && !isIdempotentStep(e.Step) {
			r.t.Errorf("non-idempotent step.ok during second setup: app=%s step=%s", e.App, e.Step)
		}
	}

	archive := filepath.Join(r.root, "b.tar.zst")
	backup := r.run("backup", "-o", archive, "--json")
	if backup.code != 0 {
		r.t.Fatalf("backup exit %d\nstdout:\n%s\nstderr:\n%s", backup.code, backup.stdout, backup.stderr)
	}
	if _, err := os.Stat(archive); err != nil {
		r.t.Fatalf("backup archive missing: %v", err)
	}

	restore := r.run("restore", archive, "--yes", "--json")
	if restore.code != 0 {
		r.t.Fatalf("restore exit %d\nstdout:\n%s\nstderr:\n%s", restore.code, restore.stdout, restore.stderr)
	}

	after := r.run("setup", "--json")
	if after.code != 0 {
		r.t.Fatalf("setup after restore exit %d%s", after.code, formatFailures(after))
	}
	for _, e := range after.events {
		if e.Event == "step.fail" {
			r.t.Fatalf("setup after restore failed: app=%s step=%s error=%s hint=%s", e.App, e.Step, e.Error, e.Hint)
		}
	}
}

func (r *runner) waitRunning(limit time.Duration) {
	r.t.Helper()
	deadline := time.Now().Add(limit)
	last := ""
	for {
		res := r.run("status", "--json")
		last = res.stdout + res.stderr
		if res.code == 0 {
			var doc statusDoc
			if json.Unmarshal([]byte(res.stdout), &doc) == nil && len(doc.Apps) > 0 && allReady(doc) {
				return
			}
		}
		if time.Now().After(deadline) {
			r.t.Fatalf("apps not running/setup after %s:\n%s", limit, last)
		}
		time.Sleep(statusPoll)
	}
}

func allReady(doc statusDoc) bool {
	for _, app := range doc.Apps {
		if app.State != "running" || app.Setup != "ok" {
			return false
		}
	}
	return true
}

func formatFailures(res result) string {
	var b strings.Builder
	for _, e := range res.events {
		if e.Event != "step.fail" {
			continue
		}
		fmt.Fprintf(&b, "\n  %s › %s: %s", e.App, e.Step, e.Error)
		if e.Hint != "" {
			fmt.Fprintf(&b, " (hint: %s)", e.Hint)
		}
	}
	return b.String()
}

func isIdempotentStep(step string) bool {
	switch step {
	case "check", "ready", "wait", "ping":
		return true
	}
	return false
}

func sanitize(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		}
		return '_'
	}, s)
}
