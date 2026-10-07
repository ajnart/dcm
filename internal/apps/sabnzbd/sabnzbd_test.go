package sabnzbd_test

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
	"github.com/ajnart/self-host/internal/apps/sabnzbd"
)

const apiKey = "0123456789abcdef0123456789abcdef"

type fakeSabnzbd struct {
	mu           sync.Mutex
	misc         map[string]string
	rejectWrites bool
}

func (f *fakeSabnzbd) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("sab")) })
	mux.HandleFunc("POST /api", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.PostForm.Get("apikey") != apiKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
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
	server := httptest.NewServer((&fakeSabnzbd{misc: map[string]string{"username": "", "password": ""}}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "sabnzbd", Service: "sabnzbd", Dir: dir,
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (sabnzbd.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (sabnzbd.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != "ok" {
		t.Fatalf("admin step = %q, want ok", rec.Status("admin"))
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
	if rec.Status("ready") != "skip" || rec.Status("admin") != "skip" {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
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
	if rec.Status("admin") != "fail" || !strings.Contains(rec.Hint(), "General") {
		t.Fatalf("admin step should fail with a General-config hint, got %q", rec.Hint())
	}
}
