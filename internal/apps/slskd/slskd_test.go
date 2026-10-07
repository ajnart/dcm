package slskd_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/slskd"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

const (
	password = "admin-password-123"
	apiKey   = "generated-api-key"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v0/session/enabled", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`true`))
	})
	mux.HandleFunc("POST /api/v0/session", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != "admin" || body.Password != password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"name": "admin", "token": "a.b.c"})
	})
	mux.HandleFunc("GET /api/v0/session", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || r.Header.Get("X-API-Key") == apiKey {
			w.Write([]byte(`{}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "slskd", Service: "slskd",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": password, "SLSKD_API_KEY": apiKey},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})
}

func TestSetupCheckPass(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (slskd.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (slskd.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := slskd.App{}
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = nil
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range results {
		if r.ID == "wait" {
			continue
		}
		if r.Status != "skip" {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
}

func TestWrongPasswordFailsWithHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	deps := systemtest.NewDeps(t)
	h := helpers.New(helpers.Config{
		App: "slskd", Service: "slskd",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong", "SLSKD_API_KEY": apiKey},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})

	err := (slskd.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-login step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-login" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != "fail" {
		t.Fatalf("admin-login did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}
