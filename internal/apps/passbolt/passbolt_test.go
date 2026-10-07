package passbolt_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/passbolt"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/verify.json", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"header": map[string]any{"status": "success"},
			"body":   map[string]any{"fingerprint": strings.Repeat("AB", 20), "keydata": "-----BEGIN PGP PUBLIC KEY BLOCK-----"},
		})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "passbolt", Service: "passbolt", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func inputs() map[string]string {
	return map[string]string{
		"PASSBOLT_CANONICAL_ORIGIN": "https://passbolt.example.com",
		"PASSBOLT_SMTP_HOST":        "smtp.example.com",
	}
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, inputs())
	ctx := context.Background()

	if err := (passbolt.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (passbolt.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	records = nil
	if err := (passbolt.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.ID == "server-key" && r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingConfigurationFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, nil)

	if err := (passbolt.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the origin and relay")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "PASSBOLT_CANONICAL_ORIGIN") {
		t.Errorf("hint should name the required input, got %q", hint)
	}
}

func TestMissingServerKeyFailsTheCheck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, inputs())

	if err := (passbolt.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("Check should fail when the server key is absent")
	}
}
