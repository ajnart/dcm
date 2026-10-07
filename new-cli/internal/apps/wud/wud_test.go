package wud_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/wud"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestComposePublishesSelectedPort(t *testing.T) {
	compose := (wud.App{}).Compose(app.RenderContext{Port: 31003})
	if !strings.Contains(compose, "${BIND_IP}:31003:3000") || strings.Contains(compose, "${BIND_IP}:18083:3000") {
		t.Fatalf("selected dashboard port not published:\n%s", compose)
	}
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

func authOK(r *http.Request) bool {
	user, pass, ok := r.BasicAuth()
	return ok && user == adminUser && pass == adminPass
}

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/user", func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"username": adminUser, "role": "admin", "provider": "local"})
	})
	mux.HandleFunc("GET /api/containers", func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{{"id": "owned-fixture", "watcher": "approved", "image": map[string]string{"id": "sha256:owned-image"}}})
	})
	mux.HandleFunc("POST /api/containers/owned-fixture/watch", func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "owned-fixture", "watcher": "approved"})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	dir := t.TempDir()
	writeTLSFixture(t, dir, false)
	return helpers.New(helpers.Config{
		App: "wud", Service: "wud", Dir: dir, BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"WUD_DOCKER_HOST": "docker.internal", "WUD_DOCKER_PORT": "2376"})
	ctx := context.Background()

	if err := (wud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (wud.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	records = nil
	if err := (wud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.ID == "admin" && r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingDockerEndpointFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, nil)

	if err := (wud.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the Docker endpoint")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "WUD_DOCKER_HOST") {
		t.Errorf("hint should name the required input, got %q", hint)
	}
}
