package homeassistant_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/homeassistant"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakeHA struct {
	mu       sync.Mutex
	password string
	failUser bool
	tokens   int
}

func (f *fakeHA) Exec(_ context.Context, _ string, env map[string]string, _ ...string) (system.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if env["SELF_HOST_MODE"] == "ensure" {
		f.tokens++
		return system.Result{Stdout: []byte(`{"status":"ok","user_id":"fixture-reader","token_id":"fixture-token-id","token":"fixture-access-token"}`)}, nil
	}
	return system.Result{Stdout: []byte(`{"status":"ok","user_id":"fixture-reader","token_id":"fixture-token-id"}`)}, nil
}

func (*fakeHA) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (*fakeHA) Restart(context.Context, ...string) error                { return nil }
func (*fakeHA) Up(context.Context, ...string) error                     { return nil }

func (f *fakeHA) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /api/onboarding", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode([]map[string]any{
			{"step": "user", "done": f.password != ""},
			{"step": "core_config", "done": f.password != ""},
			{"step": "analytics", "done": f.password != ""},
			{"step": "integration", "done": f.password != ""},
		})
	})
	mux.HandleFunc("POST /api/onboarding/users", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failUser {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.Password
		json.NewEncoder(w).Encode(map[string]any{"auth_code": "0123456789abcdef0123456789abcdef", "type": "create_entry"})
	})
	mux.HandleFunc("POST /auth/login_flow", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"type": "form", "flow_id": "0123456789abcdef0123456789abcdef"})
	})
	mux.HandleFunc("POST /auth/login_flow/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != adminUser || body.Password != f.password || f.password == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"type": "create_entry", "result": "0123456789abcdef0123456789abcdef"})
	})
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-access-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"version": "2026.9.3"})
	})
	entity := map[string]any{
		"entity_id": "input_text.fixture", "state": "controlled text", "attributes": map[string]any{"friendly_name": "Fixture"},
		"last_changed": "2026-10-11T12:00:00Z", "last_updated": "2026-10-11T12:00:00Z",
	}
	mux.HandleFunc("GET /api/states", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]any{entity})
	})
	mux.HandleFunc("GET /api/states/input_text.fixture", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-access-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(entity)
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		Peer: func(string) *helpers.H { return &helpers.H{} },
		App:  "home-assistant", Service: "home-assistant",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeHA{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	h.Config.Exec = fake
	ctx := context.Background()

	if err := (homeassistant.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (homeassistant.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (homeassistant.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if fake.tokens != 1 {
		t.Errorf("token creation count = %d, want 1", fake.tokens)
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeHA{failUser: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (homeassistant.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when user onboarding errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup home-assistant") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
