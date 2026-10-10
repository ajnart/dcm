package keycloak_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/keycloak"
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
		App: "keycloak", Service: "keycloak",
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

func handler(user, password string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /realms/master", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"realm":"master"}`))
	})
	mux.HandleFunc("POST /realms/master/protocol/openid-connect/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.PostForm.Get("username") != user || r.PostForm.Get("password") != password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"access_token":"tok"}`))
	})
	mux.HandleFunc("GET /admin/realms/master", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"realm":"master"}`))
	})
	return mux
}

func TestSetupThenCheck(t *testing.T) {
	box := newHarness(t, handler("admin", "pw"), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := keycloak.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	box := newHarness(t, handler("admin", "pw"), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := keycloak.App{}
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

func TestWrongPasswordHintNamesTheCommand(t *testing.T) {
	box := newHarness(t, handler("admin", "right"), secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong"})
	err := keycloak.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail with the wrong password")
	}
	if !strings.Contains(box.step("admin").Hint, "self-host start keycloak") {
		t.Errorf("hint should name the command, got %q", box.step("admin").Hint)
	}
}
