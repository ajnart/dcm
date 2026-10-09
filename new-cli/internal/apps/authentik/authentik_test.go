package authentik_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ajnart/self-host/internal/apps/authentik"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, handler http.Handler, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "authentik", Service: "authentik",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: sec, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { box.results = append(box.results, r) },
	})
	return box
}

func (b *harness) step(id string) helpers.StepResult {
	for i := len(b.results) - 1; i >= 0; i-- {
		if b.results[i].ID == id {
			return b.results[i]
		}
	}
	return helpers.StepResult{}
}

func handler(token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /-/health/live/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`"ok"`))
	})
	mux.HandleFunc("GET /api/v3/core/users/me/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"user":{"username":"akadmin","is_superuser":true}}`))
	})
	return mux
}

// delayedHandler models authentik's worker applying AUTHENTIK_BOOTSTRAP_TOKEN
// through a blueprint after migrations: the token is rejected for the first
// reject calls, then accepted.
func delayedHandler(token string, reject int32) http.Handler {
	var calls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("GET /-/health/live/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`"ok"`))
	})
	mux.HandleFunc("GET /api/v3/core/users/me/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token || calls.Add(1) <= reject {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Write([]byte(`{"user":{"username":"akadmin","is_superuser":true}}`))
	})
	return mux
}

func TestSetupWaitsForTheWorkerToApplyTheBootstrapToken(t *testing.T) {
	box := newHarness(t, delayedHandler("tok", 3), secrets{
		"AUTHENTIK_BOOTSTRAP_TOKEN": "tok", "ADMIN_USER": "akadmin", "ADMIN_PASSWORD": "pw",
	})
	if err := (authentik.App{}).Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup should wait for the worker to apply the token: %v", err)
	}
	if got := box.step("admin"); got.Status != stepstatus.StepOK {
		t.Errorf("admin step = %q, want ok", got.Status)
	}
}

func TestSetupThenCheck(t *testing.T) {
	box := newHarness(t, handler("tok"), secrets{
		"AUTHENTIK_BOOTSTRAP_TOKEN": "tok", "ADMIN_USER": "akadmin", "ADMIN_PASSWORD": "pw",
	})
	app := authentik.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	box := newHarness(t, handler("tok"), secrets{"AUTHENTIK_BOOTSTRAP_TOKEN": "tok"})
	app := authentik.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"admin"} {
		if got := box.step(id); got.Status != stepstatus.StepSkip {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
}

func TestMissingTokenHintNamesTheCommand(t *testing.T) {
	box := newHarness(t, handler("tok"), secrets{})
	err := authentik.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail without a bootstrap token")
	}
	if !strings.Contains(box.step("admin").Hint, "self-host start authentik") {
		t.Errorf("hint should name the command, got %q", box.step("admin").Hint)
	}
}
