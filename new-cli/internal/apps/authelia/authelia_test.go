package authelia_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"

	"github.com/ajnart/self-host/internal/apps/authelia"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestComposePublishesSelectedPort(t *testing.T) {
	compose := (authelia.App{}).Compose(app.RenderContext{Port: 31001})
	if !strings.Contains(compose, "${BIND_IP}:31001:9091") || strings.Contains(compose, "${BIND_IP}:9091:9091") {
		t.Fatalf("selected portal port not published:\n%s", compose)
	}
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
	session   = "private-session-cookie-value"
)

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "authelia", Service: "authelia",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func handler(accept bool) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/firstfactor", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Username, Password string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !accept || body.Username != adminUser || body.Password != adminPass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "authelia_session", Value: session})
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"OK"}`))
	})
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		cookie, err := r.Cookie("authelia_session")
		if err != nil || cookie.Value != session {
			w.Write([]byte(`{"status":"OK","data":{}}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "OK", "data": map[string]any{
			"username": adminUser, "authentication_level": 1, "factor_knowledge": true}})
	})
	return mux
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(handler(true))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (authelia.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (authelia.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (authelia.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer(handler(false))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (authelia.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the Admin login is rejected")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "authelia") {
		t.Errorf("hint should name the App, got %q", hint)
	}
}
