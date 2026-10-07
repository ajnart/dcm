package kopia_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/kopia"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

const password = "admin-password-123"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/current-user", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != password {
			w.Header().Set("WWW-Authenticate", `Basic realm="Kopia"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"username": "backup", "hostname": "host"})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "kopia", Service: "kopia",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": password},
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

	if err := (kopia.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (kopia.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := kopia.App{}
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
	h := helpers.New(helpers.Config{
		App: "kopia", Service: "kopia",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "not-the-saved-password"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     systemtest.NewDeps(t).Now, Sleep: systemtest.NewDeps(t).Sleep,
	})

	err := (kopia.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-auth step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-auth" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != "fail" {
		t.Fatalf("admin-auth did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}
