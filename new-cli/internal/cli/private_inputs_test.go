package cli_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/backup"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type privateInputApp struct {
	echoApp
	seen string
	fail bool
}

func (a *privateInputApp) Inputs() []app.Input {
	return []app.Input{{Key: "token", Required: true, Private: true}, {Key: "greeting", Default: "hello"}}
}

func (a *privateInputApp) Setup(ctx context.Context, h *helpers.H) error {
	a.seen = h.Inputs["token"]
	return h.Step(ctx, "configure", "configure private app", helpers.StepSpec{
		Do: func(context.Context) error {
			if a.fail {
				return errors.New("private failure " + a.seen)
			}
			return nil
		},
		Hint: "private diagnostic " + a.seen,
	})
}

// Private files are created by the test process; retain the fake home but use
// its actual host identity rather than systemtest's illustrative UID/GID1000.
func privateFileDeps(t *testing.T) *system.Deps {
	t.Helper()
	deps := systemtest.NewDeps(t)
	owner, err := deps.CurrentUser()
	if err != nil {
		t.Fatal(err)
	}
	owner.UID, owner.GID = os.Getuid(), os.Getgid()
	deps.CurrentUser = func() (system.User, error) { return owner, nil }
	return deps
}

func TestPrivateInputPublicFileTransportAndRerun(t *testing.T) {
	deps := privateFileDeps(t)
	deps.Runner.(*systemtest.Runner).On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	a := &privateInputApp{echoApp: echoApp{id: "one"}}
	cat := testCatalog(a)
	payload := "synthetic-private-input-79"
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte(payload+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json", "--set-file", "one.token="+file, "--set", "one.greeting=welcome")
	if code != 0 {
		t.Fatalf("install: %d %s", code, out)
	}
	if a.seen != payload {
		t.Fatal("Setup did not receive the private input")
	}
	root := projectRoot(t, deps)
	if !strings.Contains(readFile(t, filepath.Join(root, ".env")), "PUID=0") {
		t.Fatal("fixture did not establish rootless container UID")
	}
	if strings.Contains(out+readFile(t, filepath.Join(root, "state.json")), payload) {
		t.Fatal("private input escaped into events/state")
	}
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	secrets, err := p.LoadSecrets()
	if err != nil || secrets["ONE_TOKEN"] != payload {
		t.Fatal("private input absent from secret store")
	}
	stat, _ := os.Stat(filepath.Join(root, "secrets.env"))
	if stat.Mode().Perm() != 0o600 {
		t.Fatal("secret store is not private")
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	code, out = runWith(t, deps, cat, "install", "one", "--yes", "--json")
	if code != 0 || a.seen != payload {
		t.Fatalf("saved credential rerun: %d %s", code, out)
	}
	state, _ := p.LoadState()
	if state.Apps["one"].Inputs["greeting"] != "welcome" {
		t.Fatal("ordinary input changed")
	}
	for _, args := range [][]string{{"status", "--json"}, {"apps", "info", "one", "--json"}, {"setup", "one", "--json"}} {
		code, out = runWith(t, deps, cat, args...)
		if code != 0 || strings.Contains(out, payload) {
			t.Fatal("ordinary report leaked private input")
		}
	}
	for _, command := range deps.Runner.(*systemtest.Runner).Calls() {
		if strings.Contains(command, payload) {
			t.Fatal("private input reached command arguments")
		}
	}
}

func TestPrivateInputRejectsForeignDescriptorOwner(t *testing.T) {
	deps := systemtest.NewDeps(t)
	owner, _ := deps.CurrentUser()
	owner.UID = os.Getuid() + 1
	deps.CurrentUser = func() (system.User, error) { return owner, nil }
	a := &privateInputApp{echoApp: echoApp{id: "one"}}
	file := filepath.Join(t.TempDir(), "foreign-token")
	if err := os.WriteFile(file, []byte("synthetic-foreign-private-79"), 0o600); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, testCatalog(a), "install", "one", "--yes", "--json", "--set-file", "one.token="+file)
	if code == 0 || a.seen != "" || strings.Contains(out, "synthetic-foreign-private-79") || !strings.Contains(out, "Project owner") {
		t.Fatalf("foreign-owned file accepted or unsafe failure: %d %s", code, out)
	}
	for _, command := range deps.Runner.(*systemtest.Runner).Calls() {
		if strings.Contains(command, " up ") || strings.Contains(command, " pull ") {
			t.Fatal("foreign credential reached apply")
		}
	}
}

func TestRestoreLegacyPrivateInputMigratesAndPreservesProject(t *testing.T) {
	for _, saved := range []bool{false, true} {
		t.Run(fmt.Sprint(saved), func(t *testing.T) {
			deps, root := backupProject(t)
			a := &privateInputApp{echoApp: echoApp{id: "one"}}
			cat := testCatalog(a, &echoApp{id: "two", done: map[string]bool{}})
			owner, _ := deps.CurrentUser()
			p := project.Open(owner)
			if saved {
				secrets, _ := p.LoadSecrets()
				secrets["ONE_TOKEN"] = "synthetic-restore-saved-79"
				if err := p.SaveSecrets(secrets); err != nil {
					t.Fatal(err)
				}
			}
			state, _ := p.LoadState()
			state.Apps["one"].Inputs = map[string]string{"token": "synthetic-restore-legacy-79", "greeting": "restored-ordinary"}
			state.Apps["one"].Steps["old"] = project.StepRecord{Status: "fail", Error: "failure synthetic-restore-legacy-79"}
			data, err := json.Marshal(state)
			if err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(t.TempDir(), "legacy.tar.zst")
			f, err := os.Create(file)
			if err != nil {
				t.Fatal(err)
			}
			w, err := backup.Create(f, "", backup.Manifest{Version: 1, Apps: []backup.ManifestApp{{ID: "one"}}})
			if err != nil {
				t.Fatal(err)
			}
			entries := map[string][]byte{"state.json": data, ".env": []byte(readFile(t, p.Path(".env"))), "secrets.env": []byte("ADMIN_USER=admin\n"), "apps/one/compose.yml": []byte(readFile(t, p.Path("apps", "one", "compose.yml"))), "apps/one/db.sqlite": []byte("legacy-restored-data")}
			for name, data := range entries {
				if err := w.AddBytes(name, data, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
			code, out := runWith(t, deps, cat, "restore", file, "one", "--yes", "--json")
			if code != 0 || strings.Contains(out+readFile(t, p.Path("state.json")), "synthetic-restore-legacy-79") {
				t.Fatalf("legacy restore unsafe: %d %s", code, out)
			}
			secrets, err := p.LoadSecrets()
			if err != nil {
				t.Fatal(err)
			}
			want := "synthetic-restore-legacy-79"
			if saved {
				want = "synthetic-restore-saved-79"
			}
			if secrets["ONE_TOKEN"] != want {
				t.Fatal("legacy restore lost or rotated credential")
			}
			state, _ = p.LoadState()
			if state.Apps["one"].Inputs["greeting"] != "restored-ordinary" || readFile(t, p.Path("apps", "one", "db.sqlite")) != "legacy-restored-data" || readFile(t, filepath.Join(root, "apps", "two", "db.sqlite")) != "two-v1" {
				t.Fatal("restore lost ordinary settings or unrelated data")
			}
			code, out = runWith(t, deps, cat, "setup", "one", "--json")
			if code != 0 || a.seen != want || strings.Contains(out, want) {
				t.Fatal("restored credential not privately hydrated for Setup")
			}
		})
	}
}

func TestPrivateInputRejectsArgvWithoutPayload(t *testing.T) {
	for _, key := range []string{"one.token", "token"} {
		t.Run(key, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			a := &privateInputApp{echoApp: echoApp{id: "one"}}
			code, out := runWith(t, deps, testCatalog(a), "install", "one", "--yes", "--json", "--set", key+"=synthetic-argv-token")
			if code == 0 || strings.Contains(out, "synthetic-argv-token") || !strings.Contains(out, "--set-file") {
				t.Fatalf("unsafe argv handling: %d %s", code, out)
			}
			if _, err := os.Stat(projectRoot(t, deps)); !os.IsNotExist(err) {
				t.Fatal("rejected argv created Project")
			}
		})
	}
}

func TestCatalogCredentialsRejectPublicArgv(t *testing.T) {
	for _, field := range []string{"cloudflare-tunnel.token", "renovate.token", "tailscale.auth_key", "plex.claim_token", "gluetun.openvpn-user", "gluetun.openvpn-password"} {
		t.Run(field, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			id, _, _ := strings.Cut(field, ".")
			code, out := runWith(t, deps, catalog.Default(), "install", id, "--yes", "--json", "--set", field+"=synthetic-catalog-private-79")
			if code == 0 || strings.Contains(out, "synthetic-catalog-private-79") || !strings.Contains(out, "--set-file "+field+"=PATH") {
				t.Fatalf("catalog private input is unsafe: %d %s", code, out)
			}
			if len(deps.Runner.(*systemtest.Runner).Calls()) != 0 {
				t.Fatal("private argv rejection reached Docker")
			}
		})
	}
}

func TestLegacyPrivateInputMigratesWithoutRotatingSavedSecret(t *testing.T) {
	deps := systemtest.NewDeps(t)
	ordinary := &echoApp{id: "two", done: map[string]bool{}}
	a := &privateInputApp{echoApp: echoApp{id: "one"}}
	cat := testCatalog(a, ordinary)
	if code, out := runWith(t, deps, cat, "install", "two", "--yes", "--json"); code != 0 {
		t.Fatal(out)
	}
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	state, _ := p.LoadState()
	state.Apps["one"] = &project.AppState{Port: 9001, Inputs: map[string]string{"token": "synthetic-legacy-token", "greeting": "keep"}}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	state.Apps["one"].Steps = map[string]project.StepRecord{"old": {Status: "fail", Error: "failed synthetic-legacy-token", Hint: "retry synthetic-legacy-token"}}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "status", "--json")
	if code != 0 || strings.Contains(out, "synthetic-legacy-token") {
		t.Fatal("read-only legacy diagnostic leaked private input")
	}
	code, out = runWith(t, deps, cat, "install", "one", "--yes", "--json")
	if code != 0 || a.seen != "synthetic-legacy-token" {
		t.Fatalf("migration: %d %s", code, out)
	}
	if strings.Contains(out+readFile(t, p.Path("state.json")), "synthetic-legacy-token") {
		t.Fatal("migration retained/exposed private payload")
	}
	secrets, _ := p.LoadSecrets()
	secrets["ONE_TOKEN"] = "synthetic-saved-token"
	if err := p.SaveSecrets(secrets); err != nil {
		t.Fatal(err)
	}
	state, _ = p.LoadState()
	state.Apps["one"].Inputs["token"] = "synthetic-stale-token"
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	code, out = runWith(t, deps, cat, "install", "one", "--yes", "--json")
	if code != 0 || a.seen != "synthetic-saved-token" {
		t.Fatalf("saved credential rotated: %d %s", code, out)
	}
}

func TestPrivateInputFailureDiagnosticsAreRedacted(t *testing.T) {
	deps := privateFileDeps(t)
	a := &privateInputApp{echoApp: echoApp{id: "one"}, fail: true}
	payload := "synthetic-failure-private-79"
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, testCatalog(a), "install", "one", "--yes", "--json", "--set-file", "one.token="+file)
	if code == 0 || a.seen != payload || !strings.Contains(out, "private failure [redacted]") {
		t.Fatal("install did not reach the expected Setup failure")
	}
	state := readFile(t, filepath.Join(projectRoot(t, deps), "state.json"))
	if strings.Contains(out+state, payload) {
		t.Fatal("private failure was leaked or lost")
	}
}

func TestPrivateInputRejectsUnsafeFiles(t *testing.T) {
	for _, kind := range []string{"public", "oversized", "symlink", "directory", "multiline"} {
		t.Run(kind, func(t *testing.T) {
			deps := privateFileDeps(t)
			a := &privateInputApp{echoApp: echoApp{id: "one"}}
			file := filepath.Join(t.TempDir(), "token")
			value := "synthetic-invalid-private-79"
			if kind == "oversized" {
				value = strings.Repeat("x", 64*1024+1)
			}
			if kind == "multiline" {
				value += "\nsecond-line"
			}
			if err := os.WriteFile(file, []byte(value), 0o600); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "public":
				if err := os.Chmod(file, 0o644); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(file, file+"-link"); err != nil {
					t.Fatal(err)
				}
				file += "-link"
			case "directory":
				file = t.TempDir()
			}
			code, out := runWith(t, deps, testCatalog(a), "install", "one", "--yes", "--json", "--set-file", "one.token="+file)
			if code == 0 || strings.Contains(out, "synthetic-invalid-private-79") || a.seen != "" {
				t.Fatalf("unsafe private file accepted/leaked: %d %s", code, out)
			}
			for _, command := range deps.Runner.(*systemtest.Runner).Calls() {
				if strings.Contains(command, " up ") || strings.Contains(command, " pull ") {
					t.Fatal("unsafe file reached apply")
				}
			}
		})
	}
}
