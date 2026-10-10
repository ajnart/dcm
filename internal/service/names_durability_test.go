package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestInterruptedEnableRetainsApprovalBeforeSettingsWrite(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.svc.Log.AddSink(events.SinkFunc(func(e events.Event) {
		if e.Event == events.StepOK && e.Step == "config" {
			panic("interrupted after settings write")
		}
	}))
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("did not interrupt enable")
			}
		}()
		_ = h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"})
	}()
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	before := len(h.composeCalls())
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
		t.Fatal("interrupted enable lost startup approval")
	}
}

func TestUnrelatedActionRetainsInterruptedEnableIntentBeforeSettingsEdit(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "other", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.svc.Log.AddSink(events.SinkFunc(func(e events.Event) {
		if e.Event == events.RunStart && strings.HasPrefix(e.Msg, "config set ") {
			panic("interrupted before settings edit")
		}
	}))
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("did not interrupt")
			}
		}()
		_ = h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"})
	}()
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	before := len(h.composeCalls())
	if err := h.install("other"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
		t.Fatal("unrelated Action consumed startup approval")
	}
	p, _ := h.svc.Project()
	runtime, err := p.LoadNamesRuntime()
	if err != nil || runtime.StartAction == "" {
		t.Fatal("unrelated Action erased incomplete approval")
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=off"}); err != nil {
		t.Fatal(err)
	}
	runtime, err = p.LoadNamesRuntime()
	if err != nil || runtime.StartAction != "" {
		t.Fatal("explicit disable did not cancel approval")
	}
}

func TestRestoreFailedStartupRetainsOriginalTargetsAcrossServiceRecreation(t *testing.T) {
	for _, fresh := range []bool{false, true} {
		t.Run(map[bool]string{false: "partial", true: "fresh"}[fresh], func(t *testing.T) {
			source := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "peer", done: map[string]bool{}})
			if err := source.install("one", "peer"); err != nil {
				t.Fatal(err)
			}
			if err := source.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
				t.Fatal(err)
			}
			archive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "restore.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			h := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "peer", done: map[string]bool{}})
			var targets []string
			if !fresh {
				if err := h.install("one", "peer"); err != nil {
					t.Fatal(err)
				}
				if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
					t.Fatal(err)
				}
				targets = []string{"one", "peer"}
			}
			h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
				line := systemtest.Line(cmd)
				if strings.Contains(line, " up -d ") {
					return system.Result{ExitCode: 1}
				}
				if strings.Contains(line, " ps ") && !fresh {
					return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}` + "\n" + `{"Service":"peer","State":"exited"}`)}
				}
				return system.Result{}
			})
			if err := h.svc.Restore(context.Background(), archive, targets, ""); err == nil {
				t.Fatal("expected Restore startup failure")
			}
			h.runner.On("docker compose --project-directory", system.Result{})
			h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
			otherArchive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "different.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			beforeOther := len(h.composeCalls())
			if err := h.svc.Restore(context.Background(), otherArchive, targets, ""); err == nil || !strings.Contains(err.Error(), "pending startup") {
				t.Fatalf("different Restore consumed approval: %v", err)
			}
			if len(h.composeCalls()) != beforeOther {
				t.Fatal("different Restore mutated containers")
			}
			before := len(h.composeCalls())
			if err := h.svc.Restore(context.Background(), archive, targets, ""); err != nil {
				t.Fatal(err)
			}
			started := false
			for _, call := range h.composeCalls()[before:] {
				if strings.HasPrefix(call, "up ") && strings.Contains(call, "one") {
					started = true
				}
				if !fresh && strings.HasPrefix(call, "up ") && strings.Contains(call, "peer") {
					t.Fatal("retry started deliberately stopped peer")
				}
			}
			if !started {
				t.Fatal("Restore retry skipped originally approved target startup")
			}
			if fresh && !strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
				t.Fatal("fresh Restore retry lost Access startup")
			}
		})
	}
}

func TestFreshRestoreInterruptedAfterInitializationRetriesOriginalApproval(t *testing.T) {
	source := enabledNames(t)
	archive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "fresh.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	h.svc.Log.AddSink(events.SinkFunc(func(e events.Event) {
		if e.Event == events.RunStart && strings.HasPrefix(e.Msg, "restore ") {
			panic("interrupted after initialization")
		}
	}))
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("did not interrupt Restore")
			}
		}()
		_ = h.svc.Restore(context.Background(), archive, nil, "")
	}()
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	before := len(h.composeCalls())
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err != nil {
		t.Fatal(err)
	}
	calls := strings.Join(h.composeCalls()[before:], "\n")
	if !strings.Contains(calls, "up -d --remove-orphans one") || !strings.Contains(calls, "up -d --remove-orphans access-caddy") {
		t.Fatalf("lost fresh Restore approval: %s", calls)
	}
}

func TestRestoreRetryReconcilesApprovedPrivateNodesWithoutStartingStoppedPeers(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin", "immich")
	if err := h.installTailscale("jellyfin", "immich"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	archive, err := h.svc.Backup(context.Background(), []string{"jellyfin", "immich"}, filepath.Join(t.TempDir(), "combined.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	net.running = []string{"tailscale", "jellyfin"}
	net.stopped = []string{"immich", "tailscale-immich"}
	net.failStartup = true
	if err := h.svc.Restore(context.Background(), archive, []string{"jellyfin", "immich"}, ""); err == nil {
		t.Fatal("expected startup failure")
	}
	net.failStartup = false
	net.running = nil
	net.trackStartup = true
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	before := len(h.composeCalls())
	if err := h.svc.Restore(context.Background(), archive, []string{"jellyfin", "immich"}, ""); err != nil {
		t.Fatal(err)
	}
	started := false
	for _, call := range h.composeCalls()[before:] {
		if strings.HasPrefix(call, "up ") {
			if strings.Contains(call, "immich") || strings.Contains(call, "access-caddy") {
				t.Fatalf("started stopped peer or Access: %s", call)
			}
			if strings.Contains(call, "jellyfin") && strings.Contains(call, "tailscale-jellyfin") {
				started = true
			}
		}
	}
	if !started {
		t.Fatal("retry lost approved private node")
	}
	if !strings.Contains(h.readFile("access", "caddy", "config", "Caddyfile"), "jellyfin.192-168-1-20.sslip.io") {
		t.Fatal("Easy names route was lost")
	}
}

func TestDownCancelsPendingRestoreTargetStartup(t *testing.T) {
	h := enabledNames(t)
	archive, err := h.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "cancel.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " up -d ") {
			return system.Result{ExitCode: 1}
		}
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}`)}
		}
		return system.Result{}
	})
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err == nil {
		t.Fatal("expected failed startup")
	}
	h.runner.On("docker compose --project-directory", system.Result{})
	if err := h.svc.Down(context.Background()); err != nil {
		t.Fatal(err)
	}
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	before := len(h.composeCalls())
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err != nil {
		t.Fatal(err)
	}
	for _, call := range h.composeCalls()[before:] {
		if strings.HasPrefix(call, "up ") {
			t.Fatalf("cancelled Restore startup was reused: %s", call)
		}
	}
}

func TestRestoreMetadataFailurePrecedesReplacementAndApprovedRetryWorks(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses read-only directory permissions")
	}
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	archive, err := h.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "metadata.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(h.root(), "apps/one/marker")
	if err := os.WriteFile(marker, []byte("preserve before intent"), 0644); err != nil {
		t.Fatal(err)
	}
	blocked := false
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps ") {
			if !blocked {
				blocked = true
				if err := os.Chmod(h.root(), 0555); err != nil {
					t.Fatal(err)
				}
			}
			return system.Result{Stdout: []byte(`{"Service":"one","State":"running"}`)}
		}
		return system.Result{}
	})
	defer os.Chmod(h.root(), 0755)
	before := len(h.composeCalls())
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err == nil {
		t.Fatal("expected intent persistence failure")
	}
	if err := os.Chmod(h.root(), 0755); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(marker)
	if err != nil || string(data) != "preserve before intent" {
		t.Fatal("replaced files before approval was durable")
	}
	if len(h.composeCalls()) != before {
		t.Fatal("mutated containers before approval was durable")
	}
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err != nil {
		t.Fatal(err)
	}
}

func TestEnableMetadataSaveFailureLeavesSettingsUnchangedAndRetryWorks(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses read-only directory permissions")
	}
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	p, _ := h.svc.Project()
	beforeSettings, err := p.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(h.root(), "access/caddy")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0555); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(dir, 0755)
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err == nil {
		t.Fatal("expected metadata persistence failure")
	}
	after, err := p.LoadSettings()
	if err != nil {
		t.Fatal(err)
	}
	if after["EASY_NAMES"] != beforeSettings["EASY_NAMES"] {
		t.Fatal("settings changed before startup approval was durable")
	}
	if err := os.Chmod(dir, 0755); err != nil {
		t.Fatal(err)
	}
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	before := len(h.composeCalls())
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
		t.Fatal("approved retry did not start Access")
	}
}
