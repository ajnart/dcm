package tdarr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/tdarr"
)

type fakeTdarr struct {
	mu       sync.Mutex
	password string
	token    string
}

func (f *fakeTdarr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("tdarr")) })
	mux.HandleFunc("GET /api/v2/auth/verify-token", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.token != "" && r.Header.Get("Authorization") == "Bearer "+f.token {
			json.NewEncoder(w).Encode(map[string]any{"roles": []string{"admin"}})
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{"setupAdmin": f.password == ""})
	})
	mux.HandleFunc("POST /api/v2/public/auth/register", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.password != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.password, f.token = body.Password, "t1"
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("POST /api/v2/public/auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if f.password == "" || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"token": f.token})
	})
	return mux
}

func TestRegistersTheFirstOwnerThenProvesIt(t *testing.T) {
	server := httptest.NewServer((&fakeTdarr{}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "tdarr", Service: "tdarr",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (tdarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (tdarr.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != "ok" {
		t.Fatalf("admin step = %q, want ok", rec.Status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakeTdarr{password: "secret", token: "t1"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "tdarr", Service: "tdarr",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (tdarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("admin") != "skip" {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
}

func TestTheHintNamesTheFirstRunPage(t *testing.T) {
	server := httptest.NewServer((&fakeTdarr{password: "changed", token: "t1"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "tdarr", Service: "tdarr",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (tdarr.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail against a different owner")
	}
	if rec.Status("admin") != "fail" || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL hint, got %q", rec.Hint())
	}
}
