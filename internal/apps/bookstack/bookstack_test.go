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
	stepstatus "github.com/ajnart/self-host/internal/status"
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
func (*recordingExec) Up(context.Context, ...string) error                     { return nil }

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
		if got := box.step(id); got.Status != stepstatus.StepSkip {
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

func TestForbiddenLoginPageStopsBeforeAdminCreation(t *testing.T) {
	exec := &recordingExec{}
	box := newHarness(t, exec, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Error("forbidden login page reached password submission")
		}
		w.WriteHeader(http.StatusForbidden)
	}), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})

	err := (bookstack.App{}).Setup(context.Background(), box.h)
	if err == nil || !strings.Contains(err.Error(), "HTTP 403") {
		t.Fatalf("Setup error = %v, want fixed forbidden-login classification", err)
	}
	httpStep := box.step("http-readiness")
	if httpStep.Status != stepstatus.StepFail || !strings.Contains(httpStep.Error, "phase=login-page http_status=403") {
		t.Fatalf("HTTP readiness classification = %+v", httpStep)
	}
	if strings.Contains(httpStep.Error, "php_failure_path") || box.step("startup-status").Status != stepstatus.StepFail {
		t.Fatal("HTTP classification replaced or absorbed independent startup facts")
	}
	if box.step("admin").Status != "" {
		t.Fatal("forbidden login page reached administrator creation")
	}
	if len(exec.args) != 1 || exec.args[0][0] != "/usr/bin/with-contenv" || len(exec.envs[0]) != 0 {
		t.Fatal("forbidden login page ran more than the non-secret startup probe")
	}
}

func TestReadinessFailureReportsOnlyFixedBootstrapFacts(t *testing.T) {
	for _, tc := range []struct{ output, want string }{
		{"key=true root_pool=false launcher_root=false php_process=true upstream=true database=true authenticated=true source_match=true source_exec=true compiled_match=true compiled_exec=true wanted=true up=true config=true category=none path=unrecognized process_root=true target_read=unknown target_write=unknown target_owner=unknown worker_identity=nonroot worker_profile=php-fpm-enforced", "fpm_worker_identity=nonroot fpm_worker_profile=php-fpm-enforced"},
		{"key=true root_pool=false launcher_root=false php_process=true upstream=true database=true authenticated=true source_match=true source_exec=true compiled_match=true compiled_exec=true wanted=true up=true config=true category=none path=unrecognized process_root=true target_read=unknown target_write=unknown target_owner=unknown worker_identity=nonroot worker_profile=php-fpm-complain", "fpm_worker_identity=nonroot fpm_worker_profile=php-fpm-complain"},
		{"key=true root_pool=true launcher_root=true php_process=false upstream=false database=true authenticated=true source_match=true source_exec=true compiled_match=false compiled_exec=true wanted=true up=false config=false category=log_open path=php_log process_root=true target_read=false target_write=false target_owner=false", "launcher_root_mode=true php_process_present=false php_upstream_listening=false database_tcp_listening=true database_authenticated=true launcher_source_matches=true launcher_source_executable=true launcher_compiled_matches=false launcher_compiled_executable=true php_service_wanted=true php_service_up=false php_config_valid=false php_config_error=log_open php_failure_path=php_log process_uid_zero=true failure_path_readable=false failure_path_writable=false failure_path_owner_current=false"},
		{"key=true root_pool=false launcher_root=false php_process=true upstream=true database=true authenticated=false source_match=unknown source_exec=unknown compiled_match=unknown compiled_exec=unknown wanted=unknown up=unknown config=unknown category=unrecognized path=unrecognized process_root=true target_read=unknown target_write=unknown target_owner=unknown", "database_authenticated=false"},
		{"key=true root_pool=false launcher_root=false php_process=false upstream=false database=false authenticated=unknown source_match=unknown source_exec=unknown compiled_match=unknown compiled_exec=unknown wanted=unknown up=unknown config=unknown category=unrecognized path=unrecognized process_root=true target_read=unknown target_write=unknown target_owner=unknown", "database_authenticated=unknown"},
		{"key=synthetic-private-secret root_pool=true launcher_root=true php_process=false upstream=false database=true authenticated=true", "bootstrap_metadata=unobserved"},
		{"key=true root_pool=true launcher_root=true php_process=false upstream=false database=true authenticated=true source_match=true source_exec=true compiled_match=true compiled_exec=true wanted=true up=false config=false category=synthetic-private-secret", "bootstrap_metadata=unobserved"},
		{"key=true root_pool=false launcher_root=false php_process=true upstream=true database=true authenticated=true source_match=true source_exec=true compiled_match=true compiled_exec=true wanted=true up=true config=true category=none path=unrecognized process_root=true target_read=unknown target_write=unknown target_owner=unknown worker_identity=nonroot worker_profile=synthetic-private-secret", "bootstrap_metadata=unobserved"},
		{"synthetic-private-secret", "bootstrap_metadata=unobserved"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			executor := &recordingExec{stdout: []byte(tc.output)}
			box := newHarness(t, executor, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }), secrets{"ADMIN_PASSWORD": "synthetic-private-secret"})
			err := (bookstack.App{}).Setup(context.Background(), box.h)
			step := box.step("startup-status")
			if err == nil || !strings.Contains(err.Error(), tc.want) || step.Status != stepstatus.StepFail || !strings.Contains(step.Error, tc.want) {
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

func bootstrapProbeFixture(t *testing.T) (string, string) {
	t.Helper()
	executor := &recordingExec{}
	box := newHarness(t, executor, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }), secrets{})
	_ = (bookstack.App{}).Setup(context.Background(), box.h)
	if len(executor.args) != 1 {
		t.Fatal("missing bootstrap probe")
	}
	script := executor.args[0][3]
	dir := t.TempDir()
	source := filepath.Join(dir, "source", "run")
	compiled := filepath.Join(dir, "compiled", "run")
	for _, path := range []string{source, compiled} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := (bookstack.App{}).Files(app.RenderContext{}, nil)
	if err := os.WriteFile(source, []byte(files[0].Content), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(compiled, []byte("different launcher"), 0o755); err != nil {
		t.Fatal(err)
	}
	script = strings.ReplaceAll(script, "/etc/s6-overlay/s6-rc.d/svc-php-fpm/run", source)
	script = strings.ReplaceAll(script, "/run/service/svc-php-fpm", filepath.Dir(compiled))
	script = strings.ReplaceAll(script, "/usr/sbin/php-fpm85", filepath.Join(dir, "php-fpm85"))
	for name, body := range map[string]string{
		"id":        "#!/bin/sh\nprintf '0\\n'\n",
		"pgrep":     "#!/bin/sh\nexit 1\n",
		"timeout":   "#!/bin/sh\nshift\ncase \"$1\" in bash) exit 1;; php|s6-svstat|*/php-fpm85) exec \"$@\";; *) exit 90;; esac\n",
		"php":       "#!/bin/sh\ncase \"$*\" in *synthetic-private-secret*) exit 90;; esac\nprintf '%s' \"$FIXTURE_PHP_OUTPUT\"\nprintf '%s' \"$DB_PASSWORD\" >&2\n",
		"s6-svstat": "#!/bin/sh\n[ \"$1\" = -o ] && [ \"$2\" = up,wantedup ] || exit 90\nprintf 'false true'\n",
		"php-fpm85": "#!/bin/sh\n[ \"$1\" = -t ] && [ \"$2\" = -R ] || exit 90\nprintf '%s\\n' \"$FIXTURE_FPM_OUTPUT\" >&2\nprintf '%s' \"$DB_PASSWORD\" >&2\nexit \"$FIXTURE_FPM_EXIT\"\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return script, dir
}

func TestBootstrapProbeKeepsDatabaseCredentialAndExceptionsPrivate(t *testing.T) {
	script, dir := bootstrapProbeFixture(t)
	// PHP8.5 source phrases; private pool names, paths and directive values
	// are deliberately present to prove only fixed categories survive.
	for _, tc := range []struct{ output, want, fpm, category, code string }{
		{"true", "true", "", "none", "0"},
		{"false", "false", "ERROR: failed to open error_log (synthetic-private-secret)", "log_open", "78"},
		{"synthetic-private-secret", "unknown", "ERROR: [pool synthetic-private-secret] please specify user and group other than root", "root_identity", "78"},
		{"true", "true", "ERROR: [pool synthetic-private-secret] cannot get uid for user 'synthetic-private-secret'", "identity_lookup", "78"},
		{"true", "true", "ERROR: [synthetic-private-secret:1] unknown entry 'synthetic-private-secret'", "directive", "78"},
		{"true", "true", "ERROR: [pool synthetic-private-secret] the chdir path 'synthetic-private-secret' does not exist or is not a directory", "missing_path", "78"},
		{"true", "true", "ERROR: synthetic-private-secret: Permission denied", "permission", "78"},
		{"true", "true", "ERROR: failed to open configuration file 'synthetic-private-secret'", "config_open", "78"},
		{"true", "true", "ERROR: unable to bind listening socket for address 'synthetic-private-secret'", "socket", "78"},
		{"true", "true", "ERROR: failed to set rlimit_files for this pool synthetic-private-secret", "resource", "78"},
		{"true", "true", "synthetic-private-secret", "unrecognized", "78"},
		{"true", "true", "synthetic-private-secret", "timeout", "124"},
		{"true", "true", "synthetic-private-secret", "unavailable", "127"},
	} {
		t.Run(tc.category, func(t *testing.T) {
			command := exec.Command("bash", "-c", script)
			command.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "APP_KEY=synthetic-private-secret", "DB_PASSWORD=synthetic-private-secret", "PUID=0", "PGID=0", "FIXTURE_PHP_OUTPUT="+tc.output, "FIXTURE_FPM_OUTPUT="+tc.fpm, "FIXTURE_FPM_EXIT="+tc.code)
			output, err := command.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "authenticated="+tc.want) || !strings.Contains(string(output), "launcher_root=true") {
				t.Fatalf("probe omitted fixed observations: %v", err)
			}
			if strings.Contains(string(output), "synthetic-private") {
				t.Fatal("credential or exception output escaped bootstrap probe")
			}
			if !strings.Contains(string(output), "source_match=true\nsource_exec=true\ncompiled_match=false\ncompiled_exec=true\nwanted=true\nup=false\n") || !strings.Contains(string(output), "category="+tc.category) {
				t.Fatal("actual probe lost launcher, supervision or silent checker facts")
			}
		})
	}
}

func TestBootstrapProbeReportsActualFPMWorkerContext(t *testing.T) {
	script, dir := bootstrapProbeFixture(t)
	procRoot := filepath.Join(dir, "proc")
	for pid, status := range map[string]string{
		"100": "Name:\tphp-fpm85\nPPid:\t1\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n",
		"200": "Name:\tphp-fpm85\nPPid:\t100\nUid:\t911\t911\t911\t911\nGid:\t911\t911\t911\t911\n",
		"300": "Name:\tphp-fpm85\nUid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n",
	} {
		root := filepath.Join(procRoot, pid)
		if err := os.MkdirAll(filepath.Join(root, "attr"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "status"), []byte(status), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(procRoot, "300", "attr", "current"), []byte("php-fpm (enforce)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pgrep"), []byte("#!/bin/sh\nprintf '300\\n\\n100\\n200\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	script = strings.ReplaceAll(script, "/proc/", procRoot+"/")
	for _, tc := range []struct{ profile, want string }{
		{"php-fpm (enforce)", "php-fpm-enforced"},
		{"php-fpm (complain)", "php-fpm-complain"},
		{"unconfined", "unconfined"},
		{"unconfined-workload (enforce)", "other-enforced"},
		{"other-php-fpm-helper (enforce)", "other-enforced"},
	} {
		t.Run(tc.want+tc.profile, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(procRoot, "200", "attr", "current"), []byte(tc.profile+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			command := exec.Command("bash", "-c", script)
			command.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "FIXTURE_PHP_OUTPUT=true", "FIXTURE_FPM_EXIT=0")
			output, err := command.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "worker_identity=nonroot\nworker_profile="+tc.want) {
				t.Fatalf("probe omitted actual worker context: %v", err)
			}
			if tc.profile != tc.want && strings.Contains(string(output), tc.profile) {
				t.Fatal("raw worker profile escaped fixed projection")
			}
		})
	}
}

func TestPHPConfigPermissionPathsUseOnlyKnownMetadata(t *testing.T) {
	script, dir := bootstrapProbeFixture(t)
	marker := filepath.Join(dir, "stat-called")
	metadata := filepath.Join(dir, "known-public-path")
	if err := os.WriteFile(metadata, []byte("synthetic public fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "stat"), []byte("#!/bin/sh\nprintf called > \"$FIXTURE_STAT_MARKER\"\nprintf '0\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	// Redirect only metadata targets, keeping exact upstream error matching.
	for _, path := range []string{"/etc/php85/php-fpm.conf", "/etc/php85/php-fpm.d/www.conf", "/config/php/www2.conf", "/config/log/php/error.log", "/proc/self/fd/2"} {
		script = strings.ReplaceAll(script, "target="+path+" ;", "target="+metadata+" ;")
	}
	for _, tc := range []struct{ error, path, category string }{
		{"ERROR: failed to open configuration file '/etc/php85/php-fpm.conf': Permission denied", "main_config", "config_open"},
		{"ERROR: failed to open configuration file '/etc/php85/php-fpm.d/www.conf': Permission denied", "base_pool", "config_open"},
		{"ERROR: failed to open configuration file '/config/php/www2.conf': Permission denied", "local_pool", "config_open"},
		{"ERROR: failed to open configuration file '/config/php/www2.conf': Permission denied\nERROR: failed to load configuration file '/etc/php85/php-fpm.conf'\nERROR: FPM initialization failed", "local_pool", "config_open"},
		{"ERROR: failed to open error_log (/config/log/php/error.log): Permission denied", "php_log", "log_open"},
		{"ERROR: failed to open error_log (/proc/self/fd/2): Permission denied", "proc_stderr", "log_open"},
		{"ERROR: failed to open configuration file '/synthetic-private-secret': Permission denied", "unrecognized", "config_open"},
		{"ERROR: failed to open configuration file '/synthetic-private-secret': Permission denied\nERROR: failed to load configuration file '/etc/php85/php-fpm.conf'", "unrecognized", "config_open"},
		{"ERROR: unfamiliar failure '/etc/php85/php-fpm.conf'\nERROR: unfamiliar failure '/synthetic-private-secret': Permission denied", "unrecognized", "permission"},
		{"ERROR: failed to load configuration file '/etc/php85/php-fpm.conf'", "unrecognized", "unrecognized"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			_ = os.Remove(marker)
			command := exec.Command("bash", "-c", script)
			command.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "DB_PASSWORD=synthetic-private-secret", "FIXTURE_PHP_OUTPUT=true", "FIXTURE_FPM_OUTPUT="+tc.error, "FIXTURE_FPM_EXIT=78", "FIXTURE_STAT_MARKER="+marker)
			output, err := command.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "category="+tc.category+"\npath="+tc.path) || strings.Contains(string(output), "synthetic-private") {
				t.Fatal("path or permission category was unsafe or missing")
			}
			_, statErr := os.Stat(marker)
			if tc.path == "unrecognized" {
				if statErr == nil || !strings.Contains(string(output), "target_read=unknown\ntarget_write=unknown\ntarget_owner=unknown") {
					t.Fatal("unknown observed path was traversed")
				}
			} else if statErr != nil || !strings.Contains(string(output), "process_root=true\ntarget_read=true\ntarget_write=true\ntarget_owner=true") {
				t.Fatal("fixed metadata projection missing")
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

func TestReadablePHPMainConfigFailureSuggestsHostReview(t *testing.T) {
	for _, tc := range []struct {
		category, path, readable string
		want                     bool
	}{
		{"config_open", "main_config", "true", true},
		{"config_open", "unrecognized", "true", false},
		{"directive", "main_config", "true", false},
		{"config_open", "main_config", "false", false},
	} {

		output := "key=true root_pool=true launcher_root=true php_process=false upstream=false database=true authenticated=true source_match=true source_exec=true compiled_match=true compiled_exec=true wanted=true up=false config=false category=" + tc.category + " path=" + tc.path + " process_root=true target_read=" + tc.readable + " target_write=true target_owner=true"
		box := newHarness(t, &recordingExec{stdout: []byte(output)}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) }), secrets{})
		_ = (bookstack.App{}).Setup(context.Background(), box.h)
		hint := box.step("startup-status").Hint
		if strings.Contains(hint, "host administrator") != tc.want {
			t.Fatalf("unexpected host review recommendation for %s/%s/%s", tc.category, tc.path, tc.readable)
		}

	}
}
