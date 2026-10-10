package pangolin_test

import (
	"context"
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/pangolin"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestComposePublishesSelectedPort(t *testing.T) {
	compose := (pangolin.App{}).Compose(app.RenderContext{Port: 31002})
	if !strings.Contains(compose, "${BIND_IP}:31002:8080") || strings.Contains(compose, "${BIND_IP}:18086:8080") {
		t.Fatalf("selected dashboard port not published:\n%s", compose)
	}
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminPass = "correct-horse-battery"
	origin    = "https://pangolin.example.com"
	email     = "admin@selfhost.local"
	token     = "0123456789abcdef0123456789abcdef"
)

func TestGeneratedSetupTokenSatisfiesPinnedStartupContract(t *testing.T) {
	for _, spec := range (pangolin.App{}).Secrets() {
		if spec.Name != "setup_token" {
			continue
		}
		if !spec.Hex {
			t.Fatal("setup token must use the lowercase hex generator")
		}
		generated := service.GenerateHex(spec.Length)
		// Pinned ensureSetupToken validates this before any API starts. This
		// exercises the real installer generator, rather than a hand-fed token.
		if !regexp.MustCompile(`^[a-z0-9]{32}$`).MatchString(generated) {
			t.Fatal("generated setup token is rejected by the pinned 32-character startup contract")
		}
		return
	}
	t.Fatal("App did not declare the first-admin setup token")
}

func TestSavedInvalidTokenFailsBeforeAPICallsAndPreservesCredentials(t *testing.T) {
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		(&fakePangolin{}).handler().ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"PANGOLIN_CANONICAL_ORIGIN": origin})
	h.Dir = filepath.Join(t.TempDir(), "apps", "pangolin")
	stored := h.Secrets.(fakeSecrets)
	stored["PANGOLIN_SETUP_TOKEN"] = "0123456789abcdef"
	stored["PANGOLIN_SERVER_SECRET"] = "saved-server-secret"
	before := maps.Clone(stored)
	if err := (pangolin.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("saved invalid bootstrap token must fail fast")
	}
	if requests != 0 {
		t.Fatalf("invalid saved token made %d API calls; creation and resets must not run", requests)
	}
	if !maps.Equal(stored, before) {
		t.Fatal("saved credentials changed during invalid bootstrap-token recovery")
	}
	for _, record := range records {
		if strings.Contains(record.Error+record.Hint, stored["PANGOLIN_SETUP_TOKEN"]) || strings.Contains(record.Error+record.Hint, adminPass) {
			t.Fatal("bootstrap recovery message exposed a credential")
		}
		if record.ID != "setup-token" || record.Status != stepstatus.StepFail {
			continue
		}
		for _, required := range []string{"PANGOLIN_SETUP_TOKEN", filepath.Join(h.Dir, "..", "..", "secrets.env"), "32 lowercase alphanumeric", "ADMIN_PASSWORD", "data", "self-host install pangolin"} {
			if !strings.Contains(record.Hint, required) {
				t.Fatal("bootstrap recovery hint omitted its bounded private replacement instructions")
			}
		}
		return
	}
	t.Fatal("invalid bootstrap token did not record an actionable setup-token failure")
}

type fakePangolin struct {
	mu       sync.Mutex
	complete bool
}

func envelope(data any) map[string]any {
	return map[string]any{"status": 200, "success": true, "error": false, "message": "ok", "data": data}
}

func (f *fakePangolin) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/auth/initial-setup-complete", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(envelope(map[string]any{"complete": f.complete}))
	})
	mux.HandleFunc("PUT /api/v1/auth/set-server-admin", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Email      string `json:"email"`
			Password   string `json:"password"`
			SetupToken string `json:"setupToken"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Email != email || body.Password != adminPass || body.SetupToken != token {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.complete = true
		json.NewEncoder(w).Encode(envelope(nil))
	})
	mux.HandleFunc("POST /api/v1/auth/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if !f.complete || body.Email != email || body.Password != adminPass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(envelope(nil))
	})
	// Pinned 1.24.0 production API checks the fixed CSRF header for every
	// non-GET request, including first-admin bootstrap and login.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Header.Get("X-CSRF-Token") != "x-csrf-protection" {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "CSRF token missing or invalid"})
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "pangolin", Service: "pangolin", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": adminPass, "PANGOLIN_SETUP_TOKEN": token},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakePangolin{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"PANGOLIN_CANONICAL_ORIGIN": origin})
	ctx := context.Background()

	if err := (pangolin.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if !fake.complete {
		t.Fatal("Setup did not create the first administrator")
	}
	if err := (pangolin.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	records = nil
	if err := (pangolin.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if (r.ID == "admin" || r.ID == "management-url") && r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingOriginFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer((&fakePangolin{}).handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, nil)

	if err := (pangolin.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the origin")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host install pangolin --yes --set pangolin.PANGOLIN_CANONICAL_ORIGIN=https://pangolin.example.com") || strings.Contains(hint, "self-host setup pangolin --set") {
		t.Errorf("hint should use the supported install-time origin command, got %q", hint)
	}
}
