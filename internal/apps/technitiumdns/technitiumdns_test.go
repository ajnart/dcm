package technitiumdns_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/technitiumdns"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakeTechnitium struct {
	mu       sync.Mutex
	password string
}

func (f *fakeTechnitium) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Technitium</html>")) })
	mux.HandleFunc("POST /api/user/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.PostForm.Get("user") != adminUser || r.PostForm.Get("pass") != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "username": adminUser, "token": "admin-token"})
	})
	mux.HandleFunc("GET /api/user/profile/get", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{"username": adminUser}})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "technitium-dns", Service: "technitium-dns",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeTechnitium{password: adminPass}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (technitiumdns.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (technitiumdns.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (technitiumdns.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheStartCommand(t *testing.T) {
	fake := &fakeTechnitium{password: "a-different-password"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (technitiumdns.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator password does not authenticate")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host start technitium-dns") {
		t.Errorf("hint should name the start command, got %q", hint)
	}
}
