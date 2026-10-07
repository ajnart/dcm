package bookstack_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/bookstack"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

// recordingExec records the argv and env of every command the App runs.
type recordingExec struct {
	mu     sync.Mutex
	args   [][]string
	envs   []map[string]string
	stdout []byte
	onRun  func()
}

func (e *recordingExec) Exec(_ context.Context, _ string, env map[string]string, command ...string) (system.Result, error) {
	e.mu.Lock()
	e.args = append(e.args, append([]string(nil), command...))
	e.envs = append(e.envs, env)
	e.mu.Unlock()
	if e.onRun != nil {
		e.onRun()
	}
	return system.Result{Stdout: e.stdout}, nil
}

func (*recordingExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (*recordingExec) Restart(context.Context, ...string) error                { return nil }

type fakeBookstack struct {
	mu      sync.Mutex
	pass    string
	created bool
}

func (f *fakeBookstack) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<form method="post"><input name="_token" value="csrftok"><input name="email"><input name="password"></form>`)
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if !f.created || r.PostForm.Get("_token") != "csrftok" || r.PostForm.Get("password") != f.pass {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "bookstack_session", Value: "ok"})
		http.Redirect(w, r, "/settings/users", http.StatusFound)
	})
	mux.HandleFunc("GET /settings/users", func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("bookstack_session"); err != nil || c.Value != "ok" {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		fmt.Fprint(w, `<h1>Users</h1>`)
	})
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, exec *recordingExec, handler http.Handler, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "bookstack", Service: "bookstack",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: sec, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Exec:   exec,
		Record: func(r helpers.StepResult) { box.results = append(box.results, r) },
	})
	return box
}

func (b *harness) step(id string) helpers.StepResult {
	for i := len(b.results) - 1; i >= 0; i-- {
		if b.results[i].ID == id {
			return b.results[i]
		}
	}
	return helpers.StepResult{}
}

func TestSetupUsesTheSharedAdminLoginThenCheck(t *testing.T) {
	fake := &fakeBookstack{pass: "pw"}
	exec := &recordingExec{onRun: func() {
		fake.mu.Lock()
		fake.created = true
		fake.mu.Unlock()
	}}
	box := newHarness(t, exec, fake.handler(), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := bookstack.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if box.h.AdminPassword() != "pw" {
		t.Fatalf("ADMIN_PASSWORD changed to %q", box.h.AdminPassword())
	}
	for _, env := range exec.envs {
		if env["SELFHOST_PW"] != "pw" {
			t.Fatalf("password was not passed through the env map: %v", env)
		}
	}
	for _, argv := range exec.args {
		if strings.Contains(strings.Join(argv, " "), "pw") {
			t.Fatalf("password leaked into argv: %v", argv)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeBookstack{pass: "pw"}
	exec := &recordingExec{onRun: func() {
		fake.mu.Lock()
		fake.created = true
		fake.mu.Unlock()
	}}
	box := newHarness(t, exec, fake.handler(), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := bookstack.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"admin"} {
		if got := box.step(id); got.Status != "skip" {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
	if len(exec.args) != 1 {
		t.Errorf("artisan ran %d times, want 1: %v", len(exec.args), exec.args)
	}
}

func TestNoLoginFormHintNamesTheCommand(t *testing.T) {
	exec := &recordingExec{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<p>no form here</p>`)
	})
	box := newHarness(t, exec, mux, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	err := bookstack.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail without a login form")
	}
	hint := box.step("admin").Hint
	if !strings.Contains(hint, "bookstack:create-admin") {
		t.Errorf("hint should name the command, got %q", hint)
	}
	if !strings.Contains(hint, "admin@selfhost.local") {
		t.Errorf("hint should name the admin email, got %q", hint)
	}
}

func TestReadinessFailureReportsOnlyFixedBootstrapFacts(t *testing.T) {
	for _, tc := range []struct{ output, want string }{
		{"key=true root_pool=true launcher_root=true php_process=false upstream=false database=true authenticated=true", "launcher_root_mode=true php_process_present=false php_upstream_listening=false database_tcp_listening=true database_authenticated=true"},
		{"key=true root_pool=false launcher_root=false php_process=true upstream=true database=true authenticated=false", "database_authenticated=false"},
		{"key=true root_pool=false launcher_root=false php_process=false upstream=false database=false authenticated=unknown", "database_authenticated=unknown"},
		{"key=synthetic-private-secret root_pool=true launcher_root=true php_process=false upstream=false database=true authenticated=true", "bootstrap_metadata=unobserved"},
		{"synthetic-private-secret", "bootstrap_metadata=unobserved"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			executor := &recordingExec{stdout: []byte(tc.output)}
			box := newHarness(t, executor, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }), secrets{"ADMIN_PASSWORD": "synthetic-private-secret"})
			err := (bookstack.App{}).Setup(context.Background(), box.h)
			step := box.step("startup-status")
			if err == nil || !strings.Contains(err.Error(), tc.want) || step.Status != "fail" || !strings.Contains(step.Error, tc.want) {
				t.Fatal("failed readiness omitted fixed dependency facts")
			}
			if strings.Contains(err.Error()+step.Error+step.Hint, "synthetic-private") {
				t.Fatal("raw bootstrap output entered diagnostics")
			}
			if len(executor.args) != 1 || executor.args[0][0] != "/usr/bin/with-contenv" || box.step("admin").Status != "" {
				t.Fatal("probe lost image environment or attempted admin creation")
			}
		})
	}
}

func TestBootstrapProbeKeepsDatabaseCredentialAndExceptionsPrivate(t *testing.T) {
	executor := &recordingExec{}
	box := newHarness(t, executor, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }), secrets{})
	_ = (bookstack.App{}).Setup(context.Background(), box.h)
	if len(executor.args) != 1 {
		t.Fatal("missing bootstrap probe")
	}
	script := executor.args[0][3]
	dir := t.TempDir()
	for name, body := range map[string]string{
		"id":      "#!/bin/sh\nprintf '0\\n'\n",
		"pgrep":   "#!/bin/sh\nexit 1\n",
		"timeout": "#!/bin/sh\nshift\ncase \"$1\" in bash) exit 1;; php) exec \"$@\";; *) exit 90;; esac\n",
		"php":     "#!/bin/sh\ncase \"$*\" in *synthetic-private-secret*) exit 90;; esac\nprintf '%s' \"$FIXTURE_PHP_OUTPUT\"\nprintf '%s' \"$DB_PASSWORD\" >&2\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ output, want string }{{"true", "true"}, {"false", "false"}, {"synthetic-private-secret", "unknown"}} {
		t.Run(tc.want, func(t *testing.T) {
			command := exec.Command("bash", "-c", script)
			command.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "APP_KEY=synthetic-private-secret", "DB_PASSWORD=synthetic-private-secret", "PUID=0", "PGID=0", "FIXTURE_PHP_OUTPUT="+tc.output)
			output, err := command.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "authenticated="+tc.want) || !strings.Contains(string(output), "launcher_root=true") {
				t.Fatalf("probe omitted fixed observations: %v", err)
			}
			if strings.Contains(string(output), "synthetic-private") {
				t.Fatal("credential or exception output escaped bootstrap probe")
			}
		})
	}
}

func TestPHPFPMAllowsOnlyConfiguredRootIdentity(t *testing.T) {
	provider, ok := any(bookstack.App{}).(app.FileDeclarer)
	if !ok {
		t.Fatal("missing executable PHP-FPM launcher provider")
	}
	files := provider.Files(app.RenderContext{}, func(string) string { t.Fatal("launcher must not read secrets"); return "" })
	var launcher app.File
	for _, file := range files {
		if file.Path == "php-fpm-run" {
			launcher = file
		}
	}
	if launcher.Content == "" || launcher.Mode != 0o755 {
		t.Fatal("missing executable PHP-FPM launcher")
	}
	compose := (bookstack.App{}).Compose(app.RenderContext{Port: 8080})
	if !strings.Contains(compose, "./php-fpm-run:/etc/s6-overlay/s6-rc.d/svc-php-fpm/run:ro") {
		t.Fatal("launcher is not mounted read-only over the owned PHP-FPM service")
	}
	if !strings.HasPrefix(launcher.Content, "#!/usr/bin/with-contenv bash\n") {
		t.Fatal("launcher must preserve the upstream container environment")
	}
	dir := t.TempDir()
	// Substitute only the container's absolute executable with an argv recorder.
	php := filepath.Join(dir, "php-fpm85")
	if err := os.WriteFile(php, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "run")
	script := strings.ReplaceAll(launcher.Content, "/usr/sbin/php-fpm85", php)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		uid, gid, want string
	}{
		{"0", "0", "-F\n-R\n"},
		{"0", "1000", "-F\n-R\n"},
		{"1000", "0", "-F\n-R\n"},
		{"1000", "1000", "-F\n"},
		{"", "", "-F\n"},
	} {
		t.Run(tc.uid+"-"+tc.gid, func(t *testing.T) {
			cmd := exec.Command("bash", path)
			cmd.Env = append(os.Environ(), "PUID="+tc.uid, "PGID="+tc.gid)
			out, err := cmd.CombinedOutput()
			if err != nil || string(out) != tc.want {
				t.Fatalf("PHP-FPM args = %q, error = %v, want %q", out, err, tc.want)
			}
		})
	}
}
