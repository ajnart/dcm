package patchmon_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/patchmon"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

func TestRedisPreservesSelectedUserForPrivateConfig(t *testing.T) {
	var compose struct {
		Services map[string]struct {
			User       string
			Entrypoint []string
			Command    []string
		}
	}
	if err := yaml.Unmarshal([]byte((patchmon.App{}).Compose(app.RenderContext{Port: 31003})), &compose); err != nil {
		t.Fatal(err)
	}
	redis := compose.Services["redis"]
	if redis.User != "${PUID}:${PGID}" {
		t.Fatal("Redis must preserve the Project's explicit selected user")
	}
	// Rootless installs select container 0, which owns the mode-0600 config.
	// The image's default entrypoint drops 0 to redis before opening it, so
	// the App must supply an entrypoint that retains the selected process user.
	if len(redis.Entrypoint) == 0 {
		t.Fatal("default Redis entrypoint drops selected container 0 and cannot read its private config")
	}
	if len(redis.Command) != 2 || redis.Command[0] != "redis-server" || redis.Command[1] != "/run/secrets/redis-config" {
		t.Fatal("Redis authentication must stay in the private config, outside argv")
	}
	root := t.TempDir()
	config := filepath.Join(root, "redis-config")
	if err := os.WriteFile(config, []byte("requirepass synthetic-private-fixture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := filepath.Join(root, "redis-server")
	// Exercise the rendered entrypoint itself. This stand-in checks access as
	// the selected process user and reports only its private creation mask.
	if err := os.WriteFile(server, []byte("#!/bin/sh\ntest -r \"$1\" || exit 20\numask\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	arguments := append(append([]string{}, redis.Entrypoint[1:]...), server, config)
	for i := range arguments {
		arguments[i] = strings.ReplaceAll(arguments[i], "$$", "$") // Compose's literal-dollar escape.
	}
	command := exec.CommandContext(context.Background(), redis.Entrypoint[0], arguments...)
	output, err := command.Output()
	if err != nil {
		t.Fatal("rendered Redis entrypoint could not read the selected user's private config")
	}
	if strings.TrimSpace(string(output)) != "0077" {
		t.Fatal("rendered Redis entrypoint did not keep generated storage private")
	}
}

type fakePatchmon struct {
	hasAdmin    bool
	password    string
	rejectAdmin bool
}

func (f *fakePatchmon) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "database": "ok", "redis": "ok"})
	})
	mux.HandleFunc("GET /api/v1/settings/login-settings", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"hasAdminUsers": f.hasAdmin})
	})
	mux.HandleFunc("POST /api/v1/auth/setup-admin", func(w http.ResponseWriter, r *http.Request) {
		if f.rejectAdmin {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.Password
		f.hasAdmin = true
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"id": "1"})
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if !f.hasAdmin || body.Username != "admin" || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"token": "jwt-for-admin"})
	})
	mux.HandleFunc("GET /api/v1/auth/profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer jwt-for-admin" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{
			"id": "1", "username": "admin", "email": "admin@selfhost.local",
			"role": "superadmin", "is_active": true,
		}})
	})
	return mux
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server) (*helpers.H, *[]helpers.StepResult) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	var recorded []helpers.StepResult
	h := helpers.New(helpers.Config{
		App: "patchmon", Service: "patchmon",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakePatchmon{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (patchmon.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (patchmon.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == "fail" {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakePatchmon{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (patchmon.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (patchmon.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != "skip" {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedCreateHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakePatchmon{rejectAdmin: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (patchmon.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the first-admin write fails")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == "fail" {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, srv.URL) {
		t.Fatalf("failing step hint should name the App page, got %+v", fail)
	}
}
