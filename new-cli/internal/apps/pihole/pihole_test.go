package pihole_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/pihole"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakePihole struct {
	mu       sync.Mutex
	password string
}

func (f *fakePihole) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Pi-hole</html>")) })
	mux.HandleFunc("GET /api/auth", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"session":{"valid":true}}`))
	})
	mux.HandleFunc("POST /api/auth", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"session": map[string]any{"valid": true, "sid": "session-id"}})
	})
	mux.HandleFunc("GET /api/dns/blocking", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"blocking": "enabled", "timer": nil})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "pihole", Service: "pihole",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakePihole{password: adminPass}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (pihole.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (pihole.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (pihole.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheStartCommand(t *testing.T) {
	fake := &fakePihole{password: "a-different-password"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (pihole.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the web password does not authenticate")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host start pihole") {
		t.Errorf("hint should name the start command, got %q", hint)
	}
}

func TestAuthenticatedLocalAPIWorksWithoutVersionMetadata(t *testing.T) {
	for _, state := range []string{"enabled", "disabled"} {
		t.Run(state, func(t *testing.T) {
			fake := &fakePihole{password: adminPass}
			versionCalls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/info/version":
					versionCalls++
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte(`{"error":{"key":"internal_error","message":"private-version-error"}}`))
				case "/api/dns/blocking":
					if r.Method != http.MethodGet || r.Header.Get("X-FTL-SID") != "session-id" {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"blocking": state, "timer": nil})
				default:
					fake.handler().ServeHTTP(w, r)
				}
			}))
			defer srv.Close()
			var records []helpers.StepResult
			h := newH(t, srv, &records)
			if err := (pihole.App{}).Setup(context.Background(), h); err != nil {
				t.Fatalf("valid administrator with operational local API: %v", err)
			}
			if err := (pihole.App{}).Check(context.Background(), h); err != nil {
				t.Fatalf("Check: %v", err)
			}
			if versionCalls != 0 {
				t.Fatalf("admin acceptance depended on update metadata: %d requests", versionCalls)
			}
		})
	}
}

func TestAuthenticatedLocalAPIRejectsDeniedOrNonoperationalState(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"expired-session", 401, `private-response`},
		{"forbidden", 403, `private-response`},
		{"server-error", 500, `private-response`},
		{"dns-failure", 200, `{"blocking":"failure"}`},
		{"unknown", 200, `{"blocking":"unknown"}`},
		{"missing-status", 200, `{}`},
		{"malformed", 200, `private-response`},
		{"unexpected-status", 200, `{"blocking":"private-response"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakePihole{password: adminPass}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/dns/blocking" {
					w.WriteHeader(tc.status)
					w.Write([]byte(tc.body))
					return
				}
				fake.handler().ServeHTTP(w, r)
			}))
			defer srv.Close()
			var records []helpers.StepResult
			h := newH(t, srv, &records)
			err := (pihole.App{}).Check(context.Background(), h)
			if err == nil {
				t.Fatal("denied or nonoperational local API passed Check")
			}
			for _, private := range []string{adminPass, "session-id", "private-response"} {
				if strings.Contains(err.Error(), private) {
					t.Fatal("diagnostic disclosed private data")
				}
			}
		})
	}
}
