package actualbudget_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/actualbudget"
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

type fakeActual struct {
	mu           sync.Mutex
	bootstrapped bool
	password     string
	failBoot     bool
}

func (f *fakeActual) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /account/needs-bootstrap", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "data": map[string]any{"bootstrapped": f.bootstrapped}})
	})
	mux.HandleFunc("POST /account/bootstrap", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failBoot {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.bootstrapped, f.password = true, body.Password
		json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
	})
	mux.HandleFunc("POST /account/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if !f.bootstrapped || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "data": map[string]any{"token": "session-token"}})
	})
	mux.HandleFunc("GET /account/validate", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-actual-token") != "session-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "data": map[string]any{"validated": true, "permission": "ADMIN"}})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "actual-budget", Service: "actual-budget",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeActual{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (actualbudget.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if !fake.bootstrapped || fake.password != adminPass {
		t.Fatalf("Setup did not bootstrap the server password: %+v", fake)
	}
	if err := (actualbudget.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (actualbudget.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeActual{failBoot: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (actualbudget.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when bootstrap errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup actual-budget") || !strings.Contains(hint, "self-host credentials") {
		t.Errorf("hint should name the web page and setup command, got %q", hint)
	}
}
