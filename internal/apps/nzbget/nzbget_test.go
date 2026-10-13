package nzbget_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/nzbget"
	"github.com/ajnart/self-host/internal/compose"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

const password = "admin-password-123"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func handler(settings ...*sync.Map) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /jsonrpc", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || !(user == "admin" && pass == password || user == "self-host-homarr" && pass == "restricted-password") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var request struct{ ID, Method string }
		json.NewDecoder(r.Body).Decode(&request)
		var result any
		switch request.Method {
		case "version":
			result = "26.3"
		case "config", "loadconfig":
			if user != "admin" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			result = []map[string]string{
				{"Name": "RestrictedUsername", "Value": "self-host-homarr"},
				{"Name": "RestrictedPassword", "Value": "restricted-password"},
				{"Name": "Server1.Host", "Value": "my.newsserver.com"},
				{"Name": "Server1.Port", "Value": "563"},
				{"Name": "Server1.Connections", "Value": "8"},
				{"Name": "Server2.Host", "Value": "provider.example.invalid"},
				{"Name": "Server2.Port", "Value": "563"},
				{"Name": "Server2.Connections", "Value": "2"},
			}
		case "status":
			result = map[string]any{"DownloadPaused": false, "DownloadRate": 0}
		case "listgroups", "history":
			result = []any{}
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(settings) > 0 {
			if override, found := settings[0].Load(request.Method); found {
				result = override
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "error": nil, "result": result})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "nzbget", Service: "nzbget",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{
			"ADMIN_USER": "admin", "ADMIN_PASSWORD": password,
			"NZBGET_HOMARR_USERNAME": "self-host-homarr", "NZBGET_HOMARR_PASSWORD": "restricted-password",
		},
		Log:    events.Discard(),
		Record: func(r helpers.StepResult) { *results = append(*results, r) },
		Now:    deps.Now, Sleep: deps.Sleep,
	})
}

func TestSetupCheckPass(t *testing.T) {
	settings := &sync.Map{}
	empty := []map[string]string{
		{"Name": "RestrictedUsername", "Value": ""},
		{"Name": "RestrictedPassword", "Value": ""},
	}
	settings.Store("loadconfig", empty)
	srv := httptest.NewServer(handler(settings))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	deps := systemtest.NewDeps(t)
	runner := deps.Runner.(*systemtest.Runner)
	h.Config.Exec = compose.New(deps, h.Log, t.TempDir(), "owned-fixture")
	failWrite := true
	writes, restarts := 0, 0
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		line := systemtest.Line(cmd)
		if strings.Contains(line, " restart ") {
			restarts++
			return system.Result{}
		}
		if !strings.Contains(line, " exec ") || !strings.Contains(line, " nzbget sh -c ") {
			t.Fatal("unexpected command outside the scoped NZBGet edit")
		}
		writes++
		if strings.Contains(line, "restricted-password") || strings.Contains(line, password) {
			t.Fatal("credential appeared in command arguments")
		}
		script := cmd.Args[len(cmd.Args)-1]
		for _, control := range []string{"set -eu", "test ! -L", "trap 'rm -f", "original = os.stat", "stat.S_ISREG", "os.chown(sys.argv[2], original.st_uid, original.st_gid)"} {
			if !strings.Contains(script, control) {
				t.Fatalf("guarded edit lacks ownership control %q", control)
			}
		}
		owner := strings.Index(script, "os.chown(")
		permissions := strings.Index(script, "chmod 600")
		rename := strings.Index(script, "mv \"$temp\" \"$file\"")
		if owner < 0 || permissions <= owner || rename <= permissions {
			t.Fatal("ownership and private permissions must be applied before rename")
		}
		if failWrite {
			return system.Result{ExitCode: 1}
		}
		dir := t.TempDir()
		file := filepath.Join(dir, "nzbget.conf")
		if err := os.WriteFile(file, []byte("RestrictedUsername=\nRestrictedPassword=\nServer1.Host=provider.example.invalid\n"), 0600); err != nil {
			t.Fatal(err)
		}
		local := exec.CommandContext(t.Context(), "python3", "-")
		local.Dir = dir
		local.Env = append([]string{"PATH=" + os.Getenv("PATH")}, cmd.Env...)
		local.Env = append(local.Env, "SOURCE_SCRIPT="+strings.ReplaceAll(script, "/config/", "./"))
		local.Stdin = strings.NewReader(`import os
import stat
import subprocess

original = os.stat("nzbget.conf")
subprocess.run(["sh", "-s"], input=os.environ["SOURCE_SCRIPT"], text=True, check=True)
saved = os.stat("nzbget.conf")
assert (saved.st_uid, saved.st_gid) == (original.st_uid, original.st_gid)
assert stat.S_IMODE(saved.st_mode) == 0o600
`)
		if err := local.Run(); err != nil {
			t.Fatal("owned configuration fixture failed its UID/GID and permissions check")
		}
		content, err := os.ReadFile(file)
		if err != nil || string(content) != "RestrictedUsername=self-host-homarr\nRestrictedPassword=restricted-password\nServer1.Host=provider.example.invalid\n" {
			t.Fatal("guarded edit did not preserve the owned configuration fixture")
		}
		settings.Delete("loadconfig")
		return system.Result{}
	})
	if err := (nzbget.App{}).Setup(t.Context(), h); err == nil || !strings.Contains(err.Error(), "preserved ownership") || restarts != 0 {
		t.Fatal("failed ownership write must fail without restarting NZBGet")
	}
	if saved, _ := settings.Load("loadconfig"); saved == nil || h.Secret("NZBGET_HOMARR_PASSWORD") != "restricted-password" {
		t.Fatal("failed write changed the saved slot or managed credential")
	}
	failWrite = false

	if err := (nzbget.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (nzbget.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if writes != 2 || restarts != 0 {
		t.Fatal("retry must reuse the managed login without restarting an already active account")
	}
	settings.Store("config", []map[string]string{
		{"Name": "RestrictedUsername", "Value": "self-host-homarr"},
		{"Name": "RestrictedPassword", "Value": "restricted-password"},
		{"Name": "Server1.Host", "Value": "my.newsserver.com"},
		{"Name": "Server1.Port", "Value": "563"},
		{"Name": "Server1.Connections", "Value": "8"},
	})
	results = nil
	if err := (nzbget.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("placeholder-only provider configuration must remain Manual")
	}
	if len(results) == 0 || results[len(results)-1].ID != "usenet-provider" || results[len(results)-1].Status != stepstatus.StepManual || !strings.Contains(results[len(results)-1].Hint, "configuration only") {
		t.Fatal("missing provider must be a separate retryable settings-only Manual step")
	}
	if err := (nzbget.App{}).Check(t.Context(), h); err != nil {
		t.Fatal("provider-unavailable settings must not invalidate authenticated idle RPC")
	}
	restricted := []map[string]string{
		{"Name": "RestrictedUsername", "Value": "self-host-homarr"},
		{"Name": "RestrictedPassword", "Value": "restricted-password"},
	}
	second := append(restricted, []map[string]string{
		{"Name": "Server2.Host", "Value": "provider.example.invalid"},
		{"Name": "Server2.Port", "Value": "563"},
		{"Name": "Server2.Connections", "Value": "2"},
	}...)
	second = second[:len(second):len(second)]
	settings.Store("config", second)
	if err := (nzbget.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("Server2 alone must remain Manual because NZBGet stops at absent Server1")
	}
	settings.Store("config", append(second, map[string]string{"Name": "Server1.Active", "Value": "no"}))
	if err := (nzbget.App{}).Setup(t.Context(), h); err != nil {
		t.Fatal("a disabled Server1 definition must allow configured Server2 settings")
	}
	settings.Store("config", append(second, map[string]string{"Name": "Server1.Name", "Value": ""}))
	if err := (nzbget.App{}).Setup(t.Context(), h); err != nil {
		t.Fatal("an incomplete recognized Server1 definition must allow consecutive Server2 settings")
	}
	for _, key := range []string{"Unknown", "Notes", "IpVersion", "CertVerification"} {
		settings.Store("config", append(second, map[string]string{"Name": "Server1." + key, "Value": ""}))
		if err := (nzbget.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
			t.Fatal("a field excluded from upstream definition presence must not open the provider sequence")
		}
	}
	settings.Store("config", append(restricted, []map[string]string{
		{"Name": "Server1.Active", "Value": "no"},
		{"Name": "Server3.Host", "Value": "provider.example.invalid"},
		{"Name": "Server3.Port", "Value": "563"},
		{"Name": "Server3.Connections", "Value": "2"},
	}...))
	if err := (nzbget.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("a missing Server2 definition must stop before configured Server3 settings")
	}
	for _, prefix := range []string{"Server01", "Server+1"} {
		settings.Store("config", append(second, map[string]string{"Name": prefix + ".Name", "Value": ""}))
		if err := (nzbget.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
			t.Fatal("noncanonical indexes must not alias the missing Server1 definition")
		}
	}
	settings.Store("config", append(restricted, []map[string]string{
		{"Name": "Server1.Name", "Value": ""},
		{"Name": "Server02.Host", "Value": "provider.example.invalid"},
		{"Name": "Server02.Port", "Value": "563"},
		{"Name": "Server02.Connections", "Value": "2"},
	}...))
	if err := (nzbget.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("noncanonical provider fields must not alias a loaded Server2")
	}
	if err := (nzbget.App{}).Check(t.Context(), h); err != nil || writes != 2 || restarts != 0 {
		t.Fatal("provider index checks must preserve idle RPC and never mutate configuration")
	}
	settings.Delete("config")
	if err := (nzbget.App{}).Setup(t.Context(), h); err != nil {
		t.Fatal("configured provider settings must allow retry with an empty queue")
	}
	native, err := os.ReadFile("../homarr/target_nzbget.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(native)
	for _, guard := range []string{"#354", "requireCredentialSafeHomarr(ctx, from", "return nzbget.VerifyHomarr(ctx, to)", "verifyNZBGetIdentity(ctx, from, integrationID)", "\"integration.byId\"", "len(credentials) == 2", "stringField(integration, \"id\") == integrationID", "stringField(integration, \"kind\") == \"nzbGet\"", "seen[kind] || !present", "value != \"self-host-homarr\"", "kind == \"password\" && value != nil"} {
		if !strings.Contains(source, guard) {
			t.Fatalf("NZBGet leaf lacks source safety guard %q", guard)
		}
	}
	preflight := source[strings.Index(source, "preflight:"):strings.Index(source, "verify: verifyNZBGet")]
	if strings.Contains(preflight, "apiKey") || strings.Index(preflight, "requireCredentialSafeHomarr(ctx, from") > strings.Index(preflight, "nzbget.VerifyHomarr(ctx, to)") || strings.Index(source, "verifyNZBGetIdentity(ctx") > strings.Index(source, "readDownloadsQueue(ctx, from, integrationID") {
		t.Fatal("version gate, restricted readiness and saved-identity checks must precede activation and queries")
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	settings := &sync.Map{}
	srv := httptest.NewServer(handler(settings))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := nzbget.App{}
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = nil
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range results {
		if r.ID == "ready" {
			continue
		}
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
	settings.Store("config", []map[string]string{
		{"Name": "RestrictedUsername", "Value": ""},
		{"Name": "RestrictedPassword", "Value": ""},
	})
	deps := systemtest.NewDeps(t)
	runner := deps.Runner.(*systemtest.Runner)
	h.Config.Exec = compose.New(deps, h.Log, t.TempDir(), "owned-fixture")
	restarts := 0
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if !strings.HasSuffix(systemtest.Line(cmd), " restart nzbget") {
			t.Fatal("restart recovery must not rewrite the saved settings or touch another App")
		}
		restarts++
		if restarts == 1 {
			return system.Result{ExitCode: 1}
		}
		settings.Delete("config")
		return system.Result{}
	})
	if err := a.Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "settings are saved, but its scoped restart failed") {
		t.Fatal("failed restart must explain that saved settings remain available for retry")
	}
	if err := a.Setup(ctx, h); err != nil || restarts != 2 || h.Secret("NZBGET_HOMARR_PASSWORD") != "restricted-password" {
		t.Fatal("retry after failed restart must apply the same saved restricted login")
	}
}

func TestWrongPasswordFailsWithHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	deps := systemtest.NewDeps(t)
	h := helpers.New(helpers.Config{
		App: "nzbget", Service: "nzbget",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})

	err := (nzbget.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-rpc step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-rpc" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != stepstatus.StepFail {
		t.Fatalf("admin-rpc did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}
