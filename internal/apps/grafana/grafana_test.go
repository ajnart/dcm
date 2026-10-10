package grafana_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/grafana"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

const password = "admin-password-123"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fakeGrafana struct {
	mu      sync.Mutex
	adminOK bool
}

func (f *fakeGrafana) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"database":"ok"}`))
	})
	mux.HandleFunc("GET /api/user", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != password || !f.adminOK {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"login": "admin", "isGrafanaAdmin": true, "isDisabled": false})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "grafana", Service: "grafana",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": password},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})
}

func serve(t *testing.T, f *fakeGrafana) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestSetupCheckPass(t *testing.T) {
	fake := &fakeGrafana{adminOK: true}
	srv := serve(t, fake)
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (grafana.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (grafana.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeGrafana{adminOK: true}
	srv := serve(t, fake)
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := grafana.App{}
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	results = nil
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range results {
		if r.ID == "ready" {
			continue
		}
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepNamesTheApp(t *testing.T) {
	fake := &fakeGrafana{adminOK: false}
	srv := serve(t, fake)
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	err := (grafana.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-login step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-login" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != stepstatus.StepFail {
		t.Fatalf("admin-login did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") || !strings.Contains(fail.Hint, srv.URL) {
		t.Errorf("hint %q should name the credential and the App URL", fail.Hint)
	}
}
