package sabnzbd_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/sabnzbd"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

const apiKey = "0123456789abcdef0123456789abcdef"

type fakeSabnzbd struct {
	mu           sync.Mutex
	misc         map[string]string
	rejectWrites bool
	noProvider   bool
}

func (f *fakeSabnzbd) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("sab")) })
	mux.HandleFunc("GET /api", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("mode") != "version" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"version": "5.1.3"})
	})
	mux.HandleFunc("POST /api", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.PostForm.Get("mode") == "auth" {
			auth := "badkey"
			if r.PostForm.Get("key") == apiKey {
				auth = "apikey"
			}
			json.NewEncoder(w).Encode(map[string]any{"auth": auth})
			return
		}
		if r.PostForm.Get("apikey") != apiKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.PostForm.Get("mode") {
		case "queue":
			json.NewEncoder(w).Encode(map[string]any{"queue": map[string]any{"version": "5.1.3", "paused": false, "kbpersec": "0", "slots": []any{}}})
			return
		case "history":
			json.NewEncoder(w).Encode(map[string]any{"history": map[string]any{"slots": []any{}}})
			return
		case "get_config":
			if r.PostForm.Get("section") == "servers" {
				servers := []any{}
				if !f.noProvider {
					servers = append(servers, map[string]any{"enable": 1, "host": "owned.example.test", "connections": 1})
				}
				json.NewEncoder(w).Encode(map[string]any{"config": map[string]any{"servers": servers}})
				return
			}
		}
		keyword := r.PostForm.Get("keyword")
		if r.PostForm.Get("mode") == "set_config" {
			if f.rejectWrites {
				json.NewEncoder(w).Encode(map[string]any{"status": false})
				return
			}
			f.misc[keyword] = r.PostForm.Get("value")
		}
		json.NewEncoder(w).Encode(map[string]any{"status": true, "config": map[string]any{"misc": map[string]string{keyword: f.misc[keyword]}}})
	})
	mux.HandleFunc("POST /login/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if f.misc["username"] == "admin" && f.misc["password"] != "" && r.PostForm.Get("username") == "admin" && r.PostForm.Get("password") == f.misc["password"] {
			http.SetCookie(w, &http.Cookie{Name: "login_cookie", Value: strings.Repeat("a", 40)})
			http.SetCookie(w, &http.Cookie{Name: "login_salt", Value: "1"})
			w.Header().Set("Location", "/")
		}
		w.WriteHeader(http.StatusFound)
	})
	return mux
}

func writeConfig(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "[misc]\napi_key = " + apiKey + "\n"
	if err := os.WriteFile(filepath.Join(dir, "config", "sabnzbd.ini"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSetsTheWebUILoginThroughTheFormAPI(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	fake := &fakeSabnzbd{misc: map[string]string{"username": "", "password": ""}}
	server := httptest.NewServer(fake.handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "sabnzbd", Service: "sabnzbd", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret", "SABNZBD_API_KEY": apiKey}}, server, rec)

	if err := (sabnzbd.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (sabnzbd.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != stepstatus.StepOK {
		t.Fatalf("admin step = %q, want ok", rec.Status("admin"))
	}
	if h.Secret(h.Key("api_key")) != apiKey || rec.Status("api-key") != stepstatus.StepSkip {
		t.Fatal("Setup must reuse and verify the existing full API key")
	}
	fake.mu.Lock()
	fake.noProvider = true
	fake.mu.Unlock()
	rec.Steps = nil
	if err := (sabnzbd.App{}).Setup(context.Background(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("a missing provider should be Manual, got %v", err)
	}
	if rec.Status("api-key") != stepstatus.StepSkip || rec.Status("provider") != stepstatus.StepManual || h.Secret(h.Key("api_key")) != apiKey {
		t.Fatal("a missing provider must not invalidate or rotate the ready API key")
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	server := httptest.NewServer((&fakeSabnzbd{misc: map[string]string{"username": "admin", "password": "secret"}}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "sabnzbd", Service: "sabnzbd", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (sabnzbd.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != stepstatus.StepSkip || rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
	if err := h.SetSecret(h.Key("api_key"), ""); err != nil {
		t.Fatal(err)
	}
	rec.Steps = nil
	if err := (sabnzbd.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("recover missing Project key: %v", err)
	}
	if h.Secret(h.Key("api_key")) != apiKey || rec.Status("api-key") != stepstatus.StepOK {
		t.Fatal("retry must recover the same generated key without rotation")
	}
}

func TestTheHintNamesTheGeneralConfigPage(t *testing.T) {
	dir := t.TempDir()
	writeConfig(t, dir)
	server := httptest.NewServer((&fakeSabnzbd{misc: map[string]string{"username": "", "password": ""}, rejectWrites: true}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "sabnzbd", Service: "sabnzbd", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (sabnzbd.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the API refuses the credential write")
	}
	if rec.Status("admin") != stepstatus.StepFail || !strings.Contains(rec.Hint(), "General") {
		t.Fatalf("admin step should fail with a General-config hint, got %q", rec.Hint())
	}
}
