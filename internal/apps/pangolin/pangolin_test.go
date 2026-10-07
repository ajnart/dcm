package pangolin_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/pangolin"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminPass = "correct-horse-battery"
	origin    = "https://pangolin.example.com"
	email     = "admin@selfhost.local"
	token     = "0123456789abcdef0123456789abcdef"
)

type fakePangolin struct {
	mu       sync.Mutex
	complete bool
}

func envelope(data any) map[string]any {
	return map[string]any{"status": 200, "success": true, "error": false, "message": "ok", "data": data}
}

func (f *fakePangolin) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/auth/initial-setup-complete", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(envelope(map[string]any{"complete": f.complete}))
	})
	mux.HandleFunc("PUT /api/v1/auth/set-server-admin", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Email      string `json:"email"`
			Password   string `json:"password"`
			SetupToken string `json:"setupToken"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Email != email || body.Password != adminPass || body.SetupToken != token {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.complete = true
		json.NewEncoder(w).Encode(envelope(nil))
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if !f.complete || body.Email != email || body.Password != adminPass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(envelope(nil))
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "pangolin", Service: "pangolin", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": adminPass, "PANGOLIN_SETUP_TOKEN": token},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakePangolin{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"PANGOLIN_CANONICAL_ORIGIN": origin})
	ctx := context.Background()

	if err := (pangolin.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if !fake.complete {
		t.Fatal("Setup did not create the first administrator")
	}
	if err := (pangolin.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	records = nil
	if err := (pangolin.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if (r.ID == "admin" || r.ID == "management-url") && r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingOriginFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer((&fakePangolin{}).handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, nil)

	if err := (pangolin.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the origin")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "PANGOLIN_CANONICAL_ORIGIN") {
		t.Errorf("hint should name the required input, got %q", hint)
	}
}
