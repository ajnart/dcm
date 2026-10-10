package service

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/nextcloud"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/names"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type restoredNextcloud struct{ nextcloud.App }

func (restoredNextcloud) Setup(context.Context, *helpers.H) error { return nil }
func (restoredNextcloud) Check(context.Context, *helpers.H) error { return nil }

func TestRestoreOldNextcloudConfigReconcilesOnlyRunningRestoredTargets(t *testing.T) {
	for _, stopped := range []bool{false, true} {
		t.Run(map[bool]string{false: "running", true: "stopped"}[stopped], func(t *testing.T) {
			other := &accessProbeApp{testApp: &testApp{id: "other", done: map[string]bool{}}}
			h := newHarness(t, restoredNextcloud{}, other)
			if err := h.install("nextcloud", "other"); err != nil {
				t.Fatal(err)
			}
			file, err := h.svc.Backup(context.Background(), []string{"nextcloud"}, filepath.Join(t.TempDir(), "old.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
				t.Fatal(err)
			}
			domains := []string{"localhost", "custom.example"}
			sets := 0
			h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
				line := systemtest.Line(cmd)
				if strings.Contains(line, " ps --all") {
					state := "running"
					if stopped {
						state = "exited"
					}
					return system.Result{Stdout: []byte(`{"Service":"nextcloud","State":"` + state + `"}` + "\n" + `{"Service":"other","State":"running"}`)}
				}
				if strings.Contains(line, "config:system:get trusted_domains") {
					return system.Result{Stdout: []byte(strings.Join(domains, "\n"))}
				}
				if strings.Contains(line, "config:system:set trusted_domains") {
					sets++
					for _, env := range cmd.Env {
						if value, ok := strings.CutPrefix(env, "SELF_HOST_TRUSTED_DOMAINS="); ok {
							if err := json.Unmarshal([]byte(value), &domains); err != nil {
								t.Fatal(err)
							}
						}
					}
				}
				return system.Result{}
			})
			before := len(h.composeCalls())
			if err := h.svc.Restore(context.Background(), file, []string{"nextcloud"}, ""); err != nil {
				t.Fatal(err)
			}
			if other.configure != 0 {
				t.Fatal("Restore configured unrelated running App")
			}
			if stopped {
				if sets != 0 {
					t.Fatal("configured stopped Nextcloud")
				}
				for _, call := range h.composeCalls()[before:] {
					if strings.HasPrefix(call, "up ") && strings.Contains(call, "nextcloud") {
						t.Fatal("implicitly started stopped Nextcloud")
					}
				}
				stopped = false
				if err := h.svc.Start(context.Background(), []string{"nextcloud"}); err != nil {
					t.Fatal(err)
				}
				if sets != 1 {
					t.Fatal("explicit Start did not reconcile restored trusted hosts")
				}
			} else if sets != 1 || strings.Join(domains, ",") != "localhost,custom.example,192.168.1.20,nextcloud.192-168-1-20.sslip.io" {
				t.Fatalf("safe trusted-domain update: sets=%d domains=%v", sets, domains)
			}
			for _, call := range h.composeCalls()[before:] {
				if strings.Contains(call, "exec") && strings.Contains(call, " other ") {
					t.Fatalf("configured unrelated App: %s", call)
				}
			}
		})
	}
}

func TestFailedCaddyRestartRemainsPendingAndIdenticalRetryAppliesIt(t *testing.T) {
	h := enabledNames(t)
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "restart access-caddy") {
			return system.Result{ExitCode: 1, Stderr: []byte("restart failed")}
		}
		return retryCaddyResult(cmd)
	})
	if err := h.svc.ConfigSet(context.Background(), []string{"LAN_IP=10.0.0.7"}); err == nil {
		t.Fatal("expected restart failure")
	}
	h.svc = New(h.deps, h.svc.Log, h.svc.Catalog)
	h.deps.LANIP = func() (string, error) { return "10.0.0.7", nil }
	h.deps.HostIPs = func() ([]string, error) { return []string{"10.0.0.7"}, nil }
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Names.Working || status.Names.Problem != "pending" || len(status.Apps[0].Addresses) != 1 {
		t.Fatalf("promoted unapplied routes: %+v", status.Names)
	}
	h.ownCaddyRuns()
	before := len(h.composeCalls())
	if err := h.svc.ConfigSet(context.Background(), []string{"LAN_IP=10.0.0.7"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "restart access-caddy") {
		t.Fatal("identical retry skipped pending restart")
	}
	status, err = h.svc.Status(context.Background())
	if err != nil || !status.Names.Working {
		t.Fatalf("retry did not apply routes: %+v %v", status.Names, err)
	}
	before = len(h.composeCalls())
	if err := h.svc.Setup(context.Background(), []string{"one"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "restart access-caddy") {
		t.Fatal("no-change action restarted applied Caddy")
	}
}

func retryCaddyResult(cmd system.Cmd) system.Result {
	if strings.Contains(systemtest.Line(cmd), " ps --all") {
		return system.Result{Stdout: []byte(`{"Service":"access-caddy","State":"running","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":80,"Protocol":"tcp"}]}`)}
	}
	return system.Result{}
}

func TestFailedApprovedNamesStartupRetriesOnlyTheSameAction(t *testing.T) {
	for _, failure := range []string{"enable", "pull", "up", "caddy"} {
		t.Run(failure, func(t *testing.T) {
			h := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "other", done: map[string]bool{}})
			if failure == "enable" {
				if err := h.install("one"); err != nil {
					t.Fatal(err)
				}
			}
			action := func() error {
				if failure == "enable" {
					return h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"})
				}
				return h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, EasyNames: true})
			}
			h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
				line := systemtest.Line(cmd)
				if (failure == "enable" || failure == "caddy") && strings.Contains(line, "up -d --remove-orphans access-caddy") || failure == "pull" && strings.Contains(line, " pull ") || failure == "up" && strings.Contains(line, "up -d --remove-orphans one") {
					return system.Result{ExitCode: 1}
				}
				return system.Result{}
			})
			if err := action(); err == nil {
				t.Fatal("expected startup failure")
			}
			h.svc = New(h.deps, h.svc.Log, h.svc.Catalog)
			beforeRead := len(h.composeCalls())
			status, err := h.svc.Status(context.Background())
			if err != nil || status.Names == nil || status.Names.Working || status.Names.Problem != "pending" {
				t.Fatalf("pending startup status: %+v %v", status.Names, err)
			}
			if len(h.composeCalls()) != beforeRead {
				t.Fatal("Status mutated pending startup")
			}
			h.runner.On("docker compose --project-directory", system.Result{})
			before := len(h.composeCalls())
			if err := h.install("other"); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
				t.Fatal("unrelated action consumed startup approval")
			}
			before = len(h.composeCalls())
			if err := action(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
				t.Fatal("same-action retry did not finish approved startup")
			}
			if err := h.svc.Down(context.Background()); err != nil {
				t.Fatal(err)
			}
			before = len(h.composeCalls())
			if err := h.svc.Setup(context.Background(), []string{"one"}); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
				t.Fatal("started deliberately stopped Access")
			}
		})
	}
}

func TestDownCancelsFailedStartupApproval(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), "up -d --remove-orphans access-caddy") {
			return system.Result{ExitCode: 1}
		}
		return system.Result{}
	})
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err == nil {
		t.Fatal("expected startup failure")
	}
	h.runner.On("docker compose --project-directory", system.Result{})
	if err := h.svc.Down(context.Background()); err != nil {
		t.Fatal(err)
	}
	before := len(h.composeCalls())
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "up -d --remove-orphans access-caddy") {
		t.Fatal("Down did not cancel pending startup approval")
	}
}

func TestPendingCaddyConfigurationKeepsStoppedAccessStoppedUntilExplicitStart(t *testing.T) {
	h := enabledNames(t)
	if err := h.svc.Down(context.Background()); err != nil {
		t.Fatal(err)
	}
	h.runner.On("docker compose --project-directory", system.Result{})
	p, _ := h.svc.Project()
	if _, err := p.WriteNamesCaddyfile(names.Caddyfile(nil)); err != nil {
		t.Fatal(err)
	}
	before := len(h.composeCalls())
	if err := h.svc.Setup(context.Background(), []string{"one"}); err != nil {
		t.Fatal(err)
	}
	for _, call := range h.composeCalls()[before:] {
		if strings.Contains(call, "access-caddy") && (strings.HasPrefix(call, "up ") || strings.HasPrefix(call, "restart ")) {
			t.Fatalf("pending config started stopped Access: %s", call)
		}
	}
	status, err := h.svc.Status(context.Background())
	if err != nil || status.Names.Working || len(status.Apps[0].Addresses) != 1 {
		t.Fatalf("stopped pending config promoted: %+v %v", status.Names, err)
	}
	if err := h.svc.Start(context.Background(), []string{"one"}); err != nil {
		t.Fatal(err)
	}
	h.ownCaddyRuns()
	status, err = h.svc.Status(context.Background())
	if err != nil || !status.Names.Working {
		t.Fatalf("approved Start did not apply config: %+v %v", status.Names, err)
	}
}

func TestInterruptedCaddyWriteIsPendingUntilRunningProxyReconciles(t *testing.T) {
	h := enabledNames(t)
	p, _ := h.svc.Project()
	if _, err := p.WriteNamesCaddyfile(names.Caddyfile(nil)); err != nil {
		t.Fatal(err)
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Names.Working || status.Names.Problem != "pending" {
		t.Fatalf("interrupted write promoted: %+v", status.Names)
	}
	before := len(h.composeCalls())
	if err := h.svc.Setup(context.Background(), []string{"one"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(h.composeCalls()[before:], "\n"), "restart access-caddy") {
		t.Fatal("recovery skipped apply")
	}
}
