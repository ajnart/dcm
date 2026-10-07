package gatus_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/gatus"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "gatus", Service: "gatus", BaseURL: srv.URL, URL: srv.URL,
		HTTP:    srv.Client(),
		Secrets: fakeSecrets{},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

func healthServer(status int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
	}))
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := healthServer(http.StatusOK)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()

	if err := (gatus.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (gatus.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := healthServer(http.StatusOK)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (gatus.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (gatus.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for i, r := range results {
		if r.Status != "skip" {
			t.Errorf("rerun step %d = %q, want skip", i, r.Status)
		}
	}
}

func TestAnUnreadyAppFailsWithTheLogsHint(t *testing.T) {
	srv := healthServer(http.StatusInternalServerError)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	err := (gatus.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	if len(results) == 0 || !strings.Contains(results[len(results)-1].Hint, "self-host logs gatus") {
		t.Errorf("hint does not name the logs command: %+v", results)
	}
}
