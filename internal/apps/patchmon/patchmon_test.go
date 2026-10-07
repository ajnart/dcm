package patchmon_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/patchmon"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

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
