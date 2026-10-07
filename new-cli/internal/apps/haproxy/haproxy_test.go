package haproxy_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/haproxy"
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
)

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "haproxy", Service: "haproxy",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func handler(protected bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/_stats", func(w http.ResponseWriter, r *http.Request) {
		if !protected {
			w.Write([]byte("stats"))
			return
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != adminUser || pass != adminPass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte("stats"))
	})
	return mux
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(handler(true))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (haproxy.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (haproxy.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (haproxy.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestUnprotectedStatsFailWithAHint(t *testing.T) {
	srv := httptest.NewServer(handler(false))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (haproxy.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when statistics are public")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "haproxy") {
		t.Errorf("hint should name the App, got %q", hint)
	}
}
