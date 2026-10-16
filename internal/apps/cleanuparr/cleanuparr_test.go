package cleanuparr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/cleanuparr"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fake struct {
	user, password string
	complete       bool
	instances      int
	clients        int
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var creds struct{ Username, Password string }
	switch r.Method + " " + r.URL.Path {
	case "GET /health":
		w.WriteHeader(http.StatusOK)
	case "GET /api/auth/status":
		_ = json.NewEncoder(w).Encode(map[string]bool{"setupCompleted": f.complete})
	case "POST /api/auth/setup/account":
		_ = json.NewDecoder(r.Body).Decode(&creds)
		f.user, f.password = creds.Username, creds.Password
		w.WriteHeader(http.StatusCreated)
	case "POST /api/auth/setup/complete":
		f.complete = true
	case "POST /api/auth/login":
		_ = json.NewDecoder(r.Body).Decode(&creds)
		if !f.complete || creds.Username != f.user || creds.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"requiresTwoFactor": false, "tokens": map[string]string{"accessToken": "fixture-token"}})
	case "GET /api/configuration/sonarr", "GET /api/configuration/radarr":
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"instances": make([]struct{}, f.instances)})
	case "GET /api/configuration/download_client":
		if r.Header.Get("Authorization") != "Bearer fixture-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"clients": make([]struct{}, f.clients)})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func TestSetupCreatesAdminAndLeavesConnectionsManual(t *testing.T) {
	f := &fake{}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := helpers.New(helpers.Config{App: "cleanuparr", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(), Log: events.Discard(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-only-password"},
		Record:  func(r helpers.StepResult) { records = append(records, r) }})

	err := (cleanuparr.App{}).Setup(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "connections") {
		t.Fatalf("Setup = %v, want a manual connections step", err)
	}
	if f.user != "admin" || !f.complete {
		t.Fatalf("admin not created: %+v", f)
	}
	if len(records) != 3 || records[1].ID != "admin" || records[1].Status != stepstatus.StepOK ||
		records[2].ID != "connections" || records[2].Status != stepstatus.StepManual || !strings.Contains(records[2].Hint, "self-host credentials") {
		t.Fatalf("records = %+v", records)
	}

	f.instances, f.clients = 1, 1
	records = nil
	if err := (cleanuparr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup = %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Fatalf("second Setup records = %+v, want all skipped", records)
		}
	}
	if err := (cleanuparr.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check = %v", err)
	}
}
