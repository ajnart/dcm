package netbird_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/netbird"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
	origin    = "https://netbird.example.com"
	email     = adminUser + "@selfhost.local"
	pat       = "pat-netbird-1"
)

type fakeNetbird struct {
	mu      sync.Mutex
	created bool
}

func (f *fakeNetbird) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/instance", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"setup_required": !f.created})
	})
	mux.HandleFunc("POST /api/setup", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Email     string `json:"email"`
			Password  string `json:"password"`
			CreatePAT bool   `json:"create_pat"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Email != email || body.Password != adminPass || !body.CreatePAT {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.created = true
		json.NewEncoder(w).Encode(map[string]any{"email": email, "user_id": "u1", "personal_access_token": pat})
	})
	mux.HandleFunc("GET /api/users/current", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Token "+pat {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "u1", "email": email, "role": "owner"})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "netbird", Service: "netbird", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeNetbird{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"NETBIRD_CANONICAL_ORIGIN": origin})
	ctx := context.Background()

	if err := (netbird.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if h.Secret("NETBIRD_SETUP_TOKEN") != pat {
		t.Fatalf("setup token was not retained: %q", h.Secret("NETBIRD_SETUP_TOKEN"))
	}
	if err := (netbird.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	records = nil
	if err := (netbird.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if (r.ID == "owner" || r.ID == "management-url") && r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingManagementURLFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer((&fakeNetbird{}).handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, nil)

	if err := (netbird.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the management URL")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "NETBIRD_CANONICAL_ORIGIN") {
		t.Errorf("hint should name the required input, got %q", hint)
	}
}
