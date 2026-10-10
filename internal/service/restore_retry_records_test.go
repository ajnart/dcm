package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type restoreCredentialApp struct{ *testApp }

func (restoreCredentialApp) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "encryption_key", Length: 32}, {Name: "api_key", Length: 32}}
}

type beforeRestoreInitContext struct {
	context.Context
	p        *project.Project
	failInit bool
	reacted  bool
}

func (c *beforeRestoreInitContext) Err() error {
	startup, err := c.p.LoadRestoreStartup()
	if err != nil || startup == nil || c.p.Exists() {
		return nil
	}
	if !c.failInit {
		return context.Canceled
	}
	if !c.reacted {
		c.reacted = true
		if err := os.Chmod(c.p.Root, 0555); err != nil {
			return err
		}
	}
	return nil
}

func TestDownCancelsRestoreIntentBeforeProjectInitialization(t *testing.T) {
	for _, failInit := range []bool{false, true} {
		t.Run(map[bool]string{false: "interrupted", true: "initialization-failed"}[failInit], func(t *testing.T) {
			if failInit && os.Geteuid() == 0 {
				t.Skip("root bypasses read-only directory permissions")
			}
			source := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
			if err := source.install("one"); err != nil {
				t.Fatal(err)
			}
			archive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "first.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			otherArchive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "second.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
			p, _ := h.svc.Project()
			defer os.Chmod(p.Root, 0755)
			ctx := &beforeRestoreInitContext{Context: context.Background(), p: p, failInit: failInit}
			if err := h.svc.Restore(ctx, archive, nil, ""); err == nil {
				t.Fatal("expected failure before Project initialization")
			}
			if err := os.Chmod(p.Root, 0755); err != nil {
				t.Fatal(err)
			}
			if p.Exists() {
				t.Fatal("fixture unexpectedly created Project settings")
			}
			pending, err := p.LoadRestoreStartup()
			if err != nil || pending == nil {
				t.Fatal("fixture did not persist pre-initialization intent")
			}
			h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
			before := len(h.runner.Calls())
			if err := h.svc.Down(context.Background()); err != nil {
				t.Fatalf("cannot cancel pending intent without Project: %v", err)
			}
			if len(h.runner.Calls()) != before || p.Exists() {
				t.Fatal("cancellation initialized Project or called Docker")
			}
			if _, err := os.Stat(p.Path("secrets.env")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("cancellation created a credential file")
			}
			pending, err = p.LoadRestoreStartup()
			if err != nil || pending != nil {
				t.Fatal("Down did not clear pending Restore")
			}
			ctx = &beforeRestoreInitContext{Context: context.Background(), p: p}
			if err := h.svc.Restore(ctx, otherArchive, nil, ""); !errors.Is(err, context.Canceled) {
				t.Fatalf("different approved archive remained blocked: %v", err)
			}
			if p.Exists() || len(h.runner.Calls()) != before {
				t.Fatal("pre-initialization retry created settings or called Docker")
			}
			if err := h.svc.Down(context.Background()); err != nil {
				t.Fatal(err)
			}
			if err := h.svc.Down(context.Background()); !errors.Is(err, ErrNoProject) {
				t.Fatalf("no pending intent changed the old Down error: %v", err)
			}
		})
	}
}

func (restoreCredentialApp) Inputs() []app.Input {
	return []app.Input{{Key: "token", Private: true}}
}

func (restoreCredentialApp) Files(_ app.RenderContext, secret func(string) string) []app.File {
	return []app.File{{Path: "config.ini", Content: "encryption=" + secret("encryption_key") + "\nadmin=" + secret("ADMIN_PASSWORD") + "\n", Mode: 0600}}
}

func TestFreshRestoreRetryPreservesUnrelatedCredentialsStateAndFiles(t *testing.T) {
	source := newHarness(t, restoreCredentialApp{&testApp{id: "one", done: map[string]bool{}}})
	if err := source.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, PrivateInputs: map[string]map[string]string{"one": {"token": "fixture-source-token"}}}); err != nil {
		t.Fatal(err)
	}
	expected, err := source.svc.Credentials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	archive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "fresh.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, restoreCredentialApp{&testApp{id: "one", done: map[string]bool{}}}, restoreCredentialApp{&testApp{id: "other", done: map[string]bool{}}})
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " up -d ") {
			return system.Result{ExitCode: 1}
		}
		return system.Result{}
	})
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err == nil {
		t.Fatal("expected first startup failure")
	}
	initial, err := h.svc.Credentials(context.Background())
	if err != nil || !reflect.DeepEqual(expected.Admin, initial.Admin) {
		t.Fatal("initial fresh Restore did not restore the selected Admin login")
	}
	h.runner.On("docker compose --project-directory", system.Result{})
	if err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"other"}, AdminUser: "new-admin", AdminPassword: "Fixture-New-Admin-123!", PrivateInputs: map[string]map[string]string{"other": {"token": "fixture-unrelated-token"}}}); err != nil {
		t.Fatal(err)
	}
	before, err := h.svc.Credentials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Apps["other"]) != 3 {
		t.Fatal("unrelated credential fixture is incomplete")
	}
	p, _ := h.svc.Project()
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	beforeState := state.Apps["other"]
	beforeFile, err := os.ReadFile(filepath.Join(h.root(), "apps/other/config.ini"))
	if err != nil {
		t.Fatal(err)
	}
	h.svc = New(h.deps, events.New(h.rec), h.svc.Catalog)
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err != nil {
		t.Fatal(err)
	}
	after, err := h.svc.Credentials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Apps["other"], after.Apps["other"]) {
		t.Fatal("fresh retry erased or changed unrelated credentials")
	}
	if !reflect.DeepEqual(before.Admin, after.Admin) {
		t.Fatal("fresh retry overwrote newer Admin login")
	}
	if !reflect.DeepEqual(expected.Apps["one"], after.Apps["one"]) {
		t.Fatal("selected target credentials were not restored")
	}
	sourceConfig, err := os.ReadFile(filepath.Join(source.root(), "apps/one/config.ini"))
	if err != nil {
		t.Fatal(err)
	}
	restoredConfig, err := os.ReadFile(filepath.Join(h.root(), "apps/one/config.ini"))
	if err != nil || string(restoredConfig) != string(sourceConfig) {
		t.Fatal("selected archived configuration was not preserved")
	}
	state, err = p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	afterFile, err := os.ReadFile(filepath.Join(h.root(), "apps/other/config.ini"))
	if err != nil || string(afterFile) != string(beforeFile) || !reflect.DeepEqual(state.Apps["other"], beforeState) {
		t.Fatal("retry touched unrelated App state or files")
	}
	if h.rec.find("", "admin-login") == nil {
		t.Fatal("different restored Admin login was not explained")
	}
}

func TestFreshRestoreRetryPreservesAdminCreatedBeforeInitialRecords(t *testing.T) {
	source := newHarness(t, restoreCredentialApp{&testApp{id: "one", done: map[string]bool{}}})
	if err := source.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, PrivateInputs: map[string]map[string]string{"one": {"token": "fixture-source-token"}}}); err != nil {
		t.Fatal(err)
	}
	archive, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "initial.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, restoreCredentialApp{&testApp{id: "one", done: map[string]bool{}}}, restoreCredentialApp{&testApp{id: "other", done: map[string]bool{}}})
	h.svc.Log.AddSink(events.SinkFunc(func(e events.Event) {
		if e.Event == events.RunStart && strings.HasPrefix(e.Msg, "restore ") {
			panic("interrupted before initial records")
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
	if err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"other"}, AdminUser: "intervening-admin", AdminPassword: "Fixture-Intervening-Admin-123!", PrivateInputs: map[string]map[string]string{"other": {"token": "fixture-unrelated-token"}}}); err != nil {
		t.Fatal(err)
	}
	before, err := h.svc.Credentials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := h.svc.Restore(context.Background(), archive, nil, ""); err != nil {
		t.Fatal(err)
	}
	after, err := h.svc.Credentials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Admin, after.Admin) || !reflect.DeepEqual(before.Apps["other"], after.Apps["other"]) {
		t.Fatal("initial record retry overwrote intervening credentials")
	}
}
