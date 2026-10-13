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
	mu          sync.Mutex
	password    string
	appHash     string
	passwords   int
	activations int
}

func (f *fakePihole) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Pi-hole</html>")) })
	mux.HandleFunc("GET /api/info/login", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"dns":true,"https_port":443}`)) })
	mux.HandleFunc("GET /api/auth", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "session-id" && r.Header.Get("X-FTL-SID") != "app-session-id" {
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
		sid := "session-id"
		if body.Password == "fixture-app-password" && f.appHash == "fixture-app-hash" {
			sid = "app-session-id"
		} else if body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"session": map[string]any{"valid": true, "sid": sid}})
	})
	mux.HandleFunc("DELETE /api/auth", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "session-id" && r.Header.Get("X-FTL-SID") != "app-session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/auth/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "app-session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"sessions":[{"current_session":true,"valid":true,"app":true,"cli":false}]}`))
	})
	mux.HandleFunc("GET /api/config/webserver/api/app_sudo", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "session-id" && r.Header.Get("X-FTL-SID") != "app-session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"config":{"webserver":{"api":{"app_sudo":false}}}}`))
	})
	mux.HandleFunc("GET /api/config/webserver/api/app_pwhash", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-FTL-SID") != "session-id" && r.Header.Get("X-FTL-SID") != "app-session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"config": map[string]any{"webserver": map[string]any{"api": map[string]any{"app_pwhash": f.appHash}}}})
	})
	mux.HandleFunc("GET /api/auth/app", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-FTL-SID") != "session-id" || f.appHash != "" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		f.passwords++
		w.Write([]byte(`{"app":{"password":"fixture-app-password","hash":"fixture-app-hash"}}`))
	})
	mux.HandleFunc("PATCH /api/config", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body map[string]map[string]map[string]map[string]string
		if r.Header.Get("X-FTL-SID") != "session-id" || json.NewDecoder(r.Body).Decode(&body) != nil || len(body) != 1 || len(body["config"]) != 1 || len(body["config"]["webserver"]) != 1 || len(body["config"]["webserver"]["api"]) != 1 || body["config"]["webserver"]["api"]["app_pwhash"] != "fixture-app-hash" || f.appHash != "" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		f.appHash = "fixture-app-hash"
		f.activations++
		json.NewEncoder(w).Encode(body)
	})
	mux.HandleFunc("GET /api/stats/summary", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "app-session-id" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"queries":{"total":0,"blocked":0,"percent_blocked":0},"gravity":{"domains_being_blocked":0}}`))
	})
	mux.HandleFunc("GET /api/dns/blocking", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-FTL-SID") != "session-id" && r.Header.Get("X-FTL-SID") != "app-session-id" {
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
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.passwords != 1 || fake.activations != 1 || h.Secret("PIHOLE_HOMARR_APP_PASSWORD") != "fixture-app-password" || h.Secret("PIHOLE_HOMARR_APP_PASSWORD_HASH") != "fixture-app-hash" {
		t.Fatal("Setup must save and reuse its dedicated application password without rotating it")
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
					if r.Method != http.MethodGet || r.Header.Get("X-FTL-SID") != "session-id" && r.Header.Get("X-FTL-SID") != "app-session-id" {
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
