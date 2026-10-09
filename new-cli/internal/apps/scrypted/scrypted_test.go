package scrypted_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/scrypted"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type fakeScrypted struct {
	mu       sync.Mutex
	password string
	hasLogin bool
}

func (f *fakeScrypted) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("scrypted")) })
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username == "" && body.Password == "" {
			json.NewEncoder(w).Encode(map[string]any{"hasLogin": f.hasLogin, "error": "Username and password must not be empty."})
			return
		}
		if f.hasLogin && body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.hasLogin, f.password = true, body.Password
		json.NewEncoder(w).Encode(map[string]any{"username": body.Username, "authorization": "Bearer " + body.Password})
	})
	return mux
}

func TestCreatesTheFirstAdminThenProvesTheLogin(t *testing.T) {
	server := httptest.NewServer((&fakeScrypted{}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "scrypted", Service: "scrypted",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (scrypted.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (scrypted.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	// POST /login creates the first administrator when none exists, so the
	// login check can satisfy the step by itself.
	if status := rec.Status("admin"); status != stepstatus.StepOK && status != stepstatus.StepSkip {
		t.Fatalf("admin step = %q, want ok or skip", status)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakeScrypted{password: "secret", hasLogin: true}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "scrypted", Service: "scrypted",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (scrypted.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != stepstatus.StepSkip || rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
}

func TestTheHintNamesTheLoginPage(t *testing.T) {
	server := httptest.NewServer((&fakeScrypted{password: "changed", hasLogin: true}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "scrypted", Service: "scrypted",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	if err := (scrypted.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail against a different administrator")
	}
	if rec.Status("admin") != stepstatus.StepFail || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should fail with the App URL hint, got %q", rec.Hint())
	}
}
