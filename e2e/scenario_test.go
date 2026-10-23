//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const statusWait = 3 * time.Minute
const statusPoll = 5 * time.Second

type statusDoc struct {
	Apps []statusEntry `json:"apps"`
}

func (r *runner) stage(name string, args []string, fn func() result) bool {
	var stage *stageEvidence
	for i := range r.evidence.Stages {
		if r.evidence.Stages[i].Name == name {
			stage = &r.evidence.Stages[i]
			break
		}
	}
	if stage == nil {
		r.t.Fatal("unknown lifecycle stage")
	}
	r.requireLocalResources()
	stage.Outcome = "running"
	stage.Command = safeCommand(args)
	r.saveEvidence()
	res := result{}
	if r.commandCtx != nil {
		res.code, res.termination = commandContextOutcome(r.commandCtx.Err())
	}
	if res.termination == nil {
		res = fn()
	}
	stage.Termination = res.termination
	stage.Failures = redactedFailures(res.events, r.spec.Apps)
	for _, failure := range stage.Failures {
		label := failure.Kind
		if failure.App != "" {
			label = failure.App + "/" + failure.Step
		}
		message := compactDiagnostic(failure.Error)
		if failure.Hint != "" {
			message += "; hint: " + compactDiagnostic(failure.Hint)
		}
		r.t.Logf("%s %s: %s", name, label, message)
	}
	if res.code == exitManual && allManual(res) {
		stage.Outcome = "manual"
		stage.Reason = "first administrator requires web UI"
		r.evidence.Outcome = "manual"
		for _, event := range res.events {
			if event.Event == "step.manual" {
				stage.Apps[event.App] = "manual"
			}
		}
		r.saveEvidence()
		r.t.Skip("manual first administrator; remaining lifecycle stages stay not-run")
	}
	if res.code != 0 {
		stage.Outcome = "fail"
		stage.Reason = "command failed; no recognized redacted CLI failure event"
		if len(stage.Failures) > 0 {
			stage.Reason = "redacted CLI failure details retained"
		}
		if res.termination != nil {
			stage.Reason = res.termination.Reason
			r.t.Logf("%s: %s (exit %d)", name, stage.Reason, res.code)
		}
		r.evidence.Outcome = "failed"
		for _, event := range res.events {
			if event.Event == "step.fail" {
				if _, ok := stage.Apps[event.App]; ok {
					stage.Apps[event.App] = "fail"
				}
			}
		}
		r.saveEvidence()
		r.t.Fatalf("%s failed (exit %d); sanitized evidence saved", name, res.code)
	}
	stage.Outcome = "pass"
	for id := range stage.Apps {
		stage.Apps[id] = "pass"
	}
	r.saveEvidence()
	return true
}

func (r *runner) verify(spec targetSpec, reservation *portReservation) {
	defer reservation.closeSockets()
	r.requireLocalResources()
	payload := r.prepareBackupPayload(spec, reservation.primary)
	proxyProbe := r.prepareHAProxyProbe()
	r.prepareFixtures(reservation)
	args := installArguments(spec, r.storageRoot, reservation.primary, reservation.secondary)
	args = r.fixtureArgs(args)
	// Release socket leases immediately before Docker binds. The process-wide
	// lock is held until teardown, so another harness cannot reuse these ports.
	reservation.closeSockets()
	r.stage("install", args, func() result { return r.installFixtures(args) })
	r.stage("setup-check", []string{"setup", "--json"}, func() result { return r.setupAndReady(r) })
	r.checkFixtures("setup")
	if proxyProbe {
		r.stage("backend-routing", []string{"verify", "owned-backend-routing-and-protected-statistics"}, func() result { return r.haproxyProbe(reservation.primary) })
	}
	r.stage("idempotency", []string{"setup", "--json"}, func() result {
		res := r.setupAndReady(r)
		for _, e := range res.events {
			if e.Event == "step.ok" && !isIdempotentStep(e.Step) {
				res.code = 1
			}
		}
		return res
	})
	r.stage("restart", []string{"restart", "--json"}, func() result {
		res := r.run("restart", "--json")
		if res.code != 0 {
			return res
		}
		return r.setupAndReady(r)
	})
	r.stage("recovery", []string{"stop", "--json", "then", "start", "--json"}, func() result {
		res := r.run("stop", "--json")
		if res.code != 0 {
			return res
		}
		res = r.run("start", "--json")
		if res.code != 0 {
			return res
		}
		return r.setupAndReady(r)
	})
	r.stage("update", []string{"update", "--json"}, func() result {
		res := r.run("update", "--json")
		if res.code != 0 {
			return res
		}
		return r.setupAndReady(r)
	})
	r.checkFixtures("updated")
	r.recordImages()
	r.checkFixtures("after-images")
	if !completeImageEvidence(r.evidence.Images, expectedServices(r.spec)) {
		for i := range r.evidence.Stages {
			if r.evidence.Stages[i].Name == "update" {
				r.evidence.Stages[i].Outcome = "fail"
				r.evidence.Stages[i].Reason = "immutable image identities unavailable"
			}
		}
		r.evidence.Outcome = "failed"
		r.saveEvidence()
		r.t.Fatal("image identities unavailable")
	}
	marker := "selfhost-e2e-backup-sentinel-" + randomHex(32)
	if payload != nil {
		r.stage("payload-seed", []string{"seed", "owned-application-backup-payload"}, func() result { return payload.seed(r) })
	}
	for _, id := range spec.Apps {
		if err := os.WriteFile(filepath.Join(r.project, "apps", id, ".e2e-backup-sentinel"), []byte(marker), 0o600); err != nil {
			r.t.Fatal("write owned backup sentinel")
		}
	}
	archive := filepath.Join(r.storageRoot, "b.tar.zst")
	r.stage("backup", []string{"backup", "-o", archive, "--json"}, func() result {
		res := r.run("backup", "-o", archive, "--json")
		if res.code != 0 {
			return res
		}
		info, err := os.Stat(archive)
		if err != nil || info.Size() == 0 {
			res.code = 1
		}
		return res
	})
	restored := newRunner(r.t, r.guard, r.logDir)
	r.restored = restored
	restored.evidenceOwner = r
	restored.spec = spec
	restored.target = r.target + "-restore"
	if err := r.reattachFixtures(restored); err != nil {
		r.t.Fatal(err)
	}
	r.stage("isolated-restore", []string{"stop", "--json", "then", "restore", archive, "--yes", "--json"}, func() result {
		res := r.run("stop", "--json")
		if res.code != 0 {
			return res
		}
		r.closeFixtures(true)
		if err := r.composeDownObserved(); err != nil {
			r.guard.Block(r.project)
			r.evidence.Cleanup = "failed"
			r.evidence.RetainedProject = r.project
			r.evidence.RetainedComposeProject = r.name
			return result{code: 1}
		}
		if r.t.Failed() {
			return result{code: 1}
		}
		restored.checkFixtures("restore-start")
		return restored.run("restore", archive, "--yes", "--json")
	})
	r.stage("restored-check", []string{"setup", "--json"}, func() result { return r.setupAndReady(restored) })
	restored.checkFixtures("restored")
	if proxyProbe {
		r.stage("restored-backend-routing", []string{"verify", "owned-backend-routing-and-protected-statistics"}, func() result { return restored.haproxyProbe(reservation.primary) })
	}
	if payload != nil {
		r.stage("payload-restored", []string{"compare", "exact-application-backup-payload"}, func() result { return payload.check(restored) })
	}
	r.stage("sentinel", []string{"compare", "owned-backup-sentinels"}, func() result {
		for _, id := range spec.Apps {
			data, err := os.ReadFile(filepath.Join(restored.project, "apps", id, ".e2e-backup-sentinel"))
			if err != nil || string(data) != marker {
				return result{code: 1}
			}
		}
		return result{}
	})
	if r.evidence.complete() {
		r.evidence.Outcome = "pass"
	}
	r.saveEvidence()
}

func (r *runner) setupAndReady(target *runner) result {
	if res := target.checkFixtures("before-setup"); res.code != 0 {
		return res
	}
	res := target.run("setup", "--json")
	if res.code != 0 {
		return res
	}
	for _, e := range res.events {
		if e.Event == "step.fail" {
			res.code = 1
			return res
		}
	}
	if ready, diagnostics := target.waitRunningWithDiagnostics(statusWait, r.spec.Apps); !ready {
		res.code = 1
		res.events = append(res.events, diagnostics...)
		if target.commandCtx != nil {
			if code, termination := commandContextOutcome(target.commandCtx.Err()); termination != nil {
				res.code, res.termination = code, termination
			}
		}
	}
	return res
}

func (r *runner) waitRunning(limit time.Duration, expected []string) bool {
	ready, _ := r.waitRunningWithDiagnostics(limit, expected)
	return ready
}

func (r *runner) waitRunningWithDiagnostics(limit time.Duration, expected []string) (bool, []event) {
	ctx := r.commandCtx
	if ctx == nil {
		ctx = context.Background()
	}
	deadline := time.Now().Add(limit)
	last := statusReadinessDiagnostics("", expected, false)
	for {
		if ctx.Err() != nil {
			return false, last
		}
		res := r.runWithTimeout(30*time.Second, "status", "--json")
		var doc statusDoc
		containersOK := false
		var inventoryDiagnostics []event
		if res.code == 0 && json.Unmarshal([]byte(res.stdout), &doc) == nil && readyStatus(doc.Apps, expected) {
			containersOK, inventoryDiagnostics = r.containersReadyWithDiagnostics()
			if containersOK {
				return true, nil
			}
		}
		last = statusReadinessDiagnostics(res.stdout, expected, containersOK)
		if len(inventoryDiagnostics) != 0 {
			last = inventoryDiagnostics
		}
		if res.code != 0 && len(redactedFailures(res.events, expected)) > 0 {
			last = res.events
		}
		if time.Now().After(deadline) {
			return false, last
		}
		select {
		case <-ctx.Done():
			return false, last
		case <-time.After(statusPoll):
		}
	}
}

func (r *runner) containersReady() bool {
	ready, _ := r.containersReadyWithDiagnostics()
	return ready
}

func (r *runner) containersReadyWithDiagnostics() (bool, []event) {
	output := r.dockerOutput(30*time.Second, "compose", "-p", r.name, "ps", "-a", "--format", "json")
	expected := expectedServices(r.spec)
	return containersReadyJSON(output, expected), composeReadinessDiagnostics(output, expected)
}

func (r *runner) recordImages() {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if _, err := os.Stat(filepath.Join(r.project, "compose.yml")); err != nil {
		r.evidence.Images, r.evidence.UnavailableImages = observeOwnedImages(r.evidence.Images, expectedServices(r.spec), func(string) string { return "" }, func([]string) string { return "" })
		return
	}
	r.evidence.Images, r.evidence.UnavailableImages = observeOwnedImages(r.evidence.Images, expectedServices(r.spec), func(service string) string {
		deadline, _ := ctx.Deadline()
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return ""
		}
		return r.dockerOutput(min(30*time.Second, remaining), "compose", "-p", r.name, "images", "-q", service)
	}, func(args []string) string {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Env = r.env
		out, err := cmd.Output()
		if err != nil {
			return ""
		}
		return string(out)
	})
}

func isIdempotentStep(step string) bool {
	switch step {
	case "check", "ready", "wait", "ping":
		return true
	}
	return false
}
