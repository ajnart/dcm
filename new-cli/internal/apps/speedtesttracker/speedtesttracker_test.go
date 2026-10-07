package speedtesttracker_test

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/speedtesttracker"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

const password = "admin-password-123"

const hexKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

// fakeExecutor stands in for the pinned Laravel container: it reports whether
// the seeded administrator verified.
type fakeExecutor struct{ exit int }

func (f fakeExecutor) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	return system.Result{ExitCode: f.exit, Stdout: []byte("1")}, nil
}
func (fakeExecutor) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (fakeExecutor) Restart(context.Context, ...string) error                { return nil }

func serve(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newH(t *testing.T, srv *httptest.Server, exec fakeExecutor, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "speedtest-tracker", Service: "speedtest-tracker",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": password},
		Exec:    exec,
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})
}

func TestSetupCheckPass(t *testing.T) {
	srv := serve(t)
	var results []helpers.StepResult
	h := newH(t, srv, fakeExecutor{}, &results)

	if err := (speedtesttracker.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (speedtesttracker.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := serve(t)
	var results []helpers.StepResult
	h := newH(t, srv, fakeExecutor{}, &results)
	ctx := context.Background()
	a := speedtesttracker.App{}
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
		if r.Status != "skip" {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
}

func TestUnseededAdminFailsWithHint(t *testing.T) {
	srv := serve(t)
	var results []helpers.StepResult
	h := newH(t, srv, fakeExecutor{exit: 21}, &results)

	err := (speedtesttracker.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-login step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-login" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != "fail" || !strings.Contains(fail.Hint, "self-host credentials") {
		t.Fatalf("admin-login should fail with a credential hint: %+v", results)
	}
}

func TestFilesWritesBase64PrefixedAppKey(t *testing.T) {
	files := (speedtesttracker.App{}).Files(app.RenderContext{}, func(string) string { return hexKey })
	if len(files) != 2 || files[0].Mode != 0o600 || files[0].Path != "config/app.key" {
		t.Fatal("Files should include the mode-0600 config/app.key and PHP-FPM launcher")
	}
	raw, err := hex.DecodeString(hexKey)
	if err != nil {
		t.Fatal(err)
	}
	want := "base64:" + base64.StdEncoding.EncodeToString(raw)
	if files[0].Content != want {
		t.Errorf("app key = %q, want %q", files[0].Content, want)
	}
}

func TestPHPFPMAllowsOnlyConfiguredRootIdentity(t *testing.T) {
	files := (speedtesttracker.App{}).Files(app.RenderContext{}, func(string) string { return hexKey })
	var launcher app.File
	for _, file := range files {
		if file.Path == "php-fpm-run" {
			launcher = file
		}
	}
	if launcher.Content == "" || launcher.Mode != 0o755 {
		t.Fatal("missing executable PHP-FPM launcher")
	}
	compose := (speedtesttracker.App{}).Compose(app.RenderContext{Port: 8080})
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
