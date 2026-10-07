package portainer_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/portainer"
	"github.com/ajnart/self-host/internal/apps/porttest"
)

type fakePortainer struct {
	mu       sync.Mutex
	password string
}

func (f *fakePortainer) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("portainer")) })
	mux.HandleFunc("POST /api/auth", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if f.password == "" || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"jwt": "jwt1"})
	})
	mux.HandleFunc("GET /api/users/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer jwt1" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"Id": 1, "Username": "admin"})
	})
	return mux
}

func TestThePreseededAdministratorSignsIn(t *testing.T) {
	server := httptest.NewServer((&fakePortainer{password: "portainer-secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "portainer", Service: "portainer",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "unused", "PORTAINER_ADMIN_PASSWORD": "portainer-secret"}}, server, rec)

	if err := (portainer.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (portainer.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != "skip" {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakePortainer{password: "portainer-secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "portainer", Service: "portainer",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "PORTAINER_ADMIN_PASSWORD": "portainer-secret"}}, server, rec)

	if err := (portainer.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("admin") != "skip" {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
}

func TestTheHintNamesTheAppWhenTheSeedIsStale(t *testing.T) {
	server := httptest.NewServer((&fakePortainer{password: "changed"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "portainer", Service: "portainer",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "PORTAINER_ADMIN_PASSWORD": "portainer-secret"}}, server, rec)

	if err := (portainer.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the preseeded password is refused")
	}
	if rec.Status("admin") != "fail" || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL hint, got %q", rec.Hint())
	}
}
