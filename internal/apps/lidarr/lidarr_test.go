package lidarr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/lidarr"
	"github.com/ajnart/self-host/internal/apps/porttest"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type fakeLidarr struct {
	mu         sync.Mutex
	key        string
	forms      bool
	user       string
	password   string
	rejectPut  bool
	statusBody string
}

func (f *fakeLidarr) host() map[string]any {
	method, required, user := "none", "disabled", ""
	if f.forms {
		method, required, user = "forms", "enabled", f.user
	}
	return map[string]any{"id": 1, "authenticationMethod": method, "authenticationRequired": required, "username": user}
}

func (f *fakeLidarr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("pong")) })
	mux.HandleFunc("GET /api/v1/system/status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-Api-Key") != f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.statusBody != "" {
			w.Write([]byte(f.statusBody))
			return
		}
		w.Write([]byte(`{"appName":"Lidarr","version":"3.1.0.4875"}`))
	})
	mux.HandleFunc("GET /api/v1/config/host", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-Api-Key") != f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(f.host())
	})
	mux.HandleFunc("PUT /api/v1/config/host/1", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.rejectPut {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.forms, f.user, f.password = true, body.Username, body.Password
		w.Write([]byte("{}"))
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if f.forms && r.PostForm.Get("username") == f.user && r.PostForm.Get("password") == f.password {
			w.Header().Set("Location", "/")
		} else {
			w.Header().Set("Location", "/login?loginFailed=true")
		}
		w.WriteHeader(http.StatusFound)
	})
	return mux
}

func writeConfig(t *testing.T, dir, key string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "<Config><ApiKey>" + key + "</ApiKey></Config>"
	if err := os.WriteFile(filepath.Join(dir, "config", "config.xml"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReadsTheAPIKeyAndRequiresFormsAuth(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "0123456789abcdef0123456789abcdef")
	fake := &fakeLidarr{key: "0123456789abcdef0123456789abcdef"}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (lidarr.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("api-key") != stepstatus.StepOK || rec.Status("auth") != stepstatus.StepOK {
		t.Fatalf("api-key=%q auth=%q, want ok", rec.Status("api-key"), rec.Status("auth"))
	}
	for _, body := range []string{`{}`, `null`, `[]`, `<html>sign in</html>`, `{"appName":"Sonarr","version":"3.1.0.4875"}`, `{"appName":"Lidarr"}`} {
		fake.mu.Lock()
		fake.statusBody = body
		fake.mu.Unlock()
		if err := (lidarr.App{}).Check(context.Background(), h); err == nil {
			t.Fatalf("Check accepted invalid API status: %s", body)
		}
	}
	fake.mu.Lock()
	fake.statusBody, fake.forms = "", false
	fake.mu.Unlock()
	if err := (lidarr.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("Check accepted disabled Forms authentication")
	}
}

func TestRerunSkipsTheConfigurationSteps(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "0123456789abcdef0123456789abcdef")
	server := httptest.NewServer((&fakeLidarr{key: "0123456789abcdef0123456789abcdef",
		forms: true, user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret",
			"LIDARR_API_KEY": "0123456789abcdef0123456789abcdef"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("api-key") != stepstatus.StepSkip || rec.Status("auth") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip config steps: api-key=%q auth=%q", rec.Status("api-key"), rec.Status("auth"))
	}
}

func TestTheHintNamesTheSecurityPage(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir, "0123456789abcdef0123456789abcdef")
	server := httptest.NewServer((&fakeLidarr{key: "0123456789abcdef0123456789abcdef", rejectPut: true}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "lidarr", Service: "lidarr", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (lidarr.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the host configuration cannot be updated")
	}
	if rec.Status("auth") != stepstatus.StepFail || !strings.Contains(rec.Hint(), "Security") {
		t.Fatalf("auth step should fail with a Security-page hint, got %q", rec.Hint())
	}
}
