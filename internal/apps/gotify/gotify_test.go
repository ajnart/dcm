package gotify_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/gotify"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

const (
	adminUser     = "admin"
	adminPassword = "Pa55word-long"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "gotify", Service: "gotify", BaseURL: srv.URL, URL: srv.URL,
		HTTP:    srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPassword},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

// fakeGotify models GET /version and GET /current/user from the v3.1.1 API.
func fakeGotify(acceptPassword string) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /version", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":"3.1.1"}`))
	})
	mux.HandleFunc("GET /current/user", func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != adminUser || password != acceptPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"name":"admin","admin":true,"id":1}`))
	})
	return httptest.NewServer(mux)
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := fakeGotify(adminPassword)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()

	if err := (gotify.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (gotify.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := fakeGotify(adminPassword)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (gotify.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (gotify.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("no steps recorded on the rerun")
	}
	for i, r := range results {
		if r.Status != "skip" {
			t.Errorf("rerun step %d (%s) = %q, want skip", i, r.ID, r.Status)
		}
	}
}

func TestARejectedAdminLoginNamesTheCredentialCommand(t *testing.T) {
	srv := fakeGotify("some-other-password")
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	err := (gotify.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	fail := results[len(results)-1]
	if fail.Status != "fail" || !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint does not name the credentials command: %+v", fail)
	}
}
