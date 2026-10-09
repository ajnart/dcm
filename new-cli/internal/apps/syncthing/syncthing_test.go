package syncthing_test

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

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/syncthing"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

const apiKey = "0123456789abcdef0123456789abcdef"

type fakeSyncthing struct {
	mu       sync.Mutex
	user     string
	password string
}

func (f *fakeSyncthing) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /rest/noauth/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"OK"}`))
	})
	mux.HandleFunc("GET /rest/config/gui", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-API-Key") != apiKey {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"user": f.user, "password": f.password, "sendBasicAuthPrompt": true})
	})
	mux.HandleFunc("PATCH /rest/config/gui", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-API-Key") != apiKey {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		var body struct {
			User     string `json:"user"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.user, f.password = body.User, body.Password
		w.Write([]byte("{}"))
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		user, password, ok := r.BasicAuth()
		if !ok || user != f.user || password != f.password || f.user == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte("gui"))
	})
	return mux
}

func writeConfig(t *testing.T, dir string) {
	t.Helper()
	path := filepath.Join(dir, "syncthing-data", "config")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "config.xml"), []byte("<configuration><gui><apikey>"+apiKey+"</apikey></gui></configuration>"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSetsTheGUILoginThroughREST(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	server := httptest.NewServer((&fakeSyncthing{}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "syncthing", Service: "syncthing", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (syncthing.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (syncthing.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != stepstatus.StepOK {
		t.Fatalf("admin step = %q, want ok", rec.Status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	server := httptest.NewServer((&fakeSyncthing{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "syncthing", Service: "syncthing", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (syncthing.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != stepstatus.StepSkip || rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
}

func TestTheHintNamesTheAppWhenTheConfigNeverAppears(t *testing.T) {
	server := httptest.NewServer((&fakeSyncthing{}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "syncthing", Service: "syncthing", Dir: t.TempDir(),
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (syncthing.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the config file is missing")
	}
	if rec.Status("admin") != stepstatus.StepFail || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL hint, got %q", rec.Hint())
	}
}
