package bazarr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/bazarr"
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
	apiKey    = "0123456789abcdef0123456789abcdef"
)

type fakeBazarr struct {
	mu            sync.Mutex
	user          string
	pass          string
	failSet       bool
	key           string
	apiStatus     int
	statusBody    string
	badgesBody    string
	settingsPosts int
}

func (f *fakeBazarr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.user == "" {
			w.WriteHeader(http.StatusOK)
			return
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != f.user || pass != f.pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /api/system/settings", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("X-API-KEY") != apiKey || f.failSet {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		r.ParseForm()
		f.user, f.pass = r.PostForm.Get("settings-auth-username"), r.PostForm.Get("settings-auth-password")
		f.settingsPosts++
		w.WriteHeader(http.StatusNoContent)
	})
	for _, path := range []string{"/api/system/status", "/api/badges"} {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			defer f.mu.Unlock()
			key := f.key
			if key == "" {
				key = apiKey
			}
			if r.Header.Get("X-API-KEY") != key {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if f.apiStatus != 0 {
				w.WriteHeader(f.apiStatus)
				return
			}
			if path == "/api/system/status" {
				if f.statusBody != "" {
					w.Write([]byte(f.statusBody))
					return
				}
				w.Write([]byte(`{"data":{"bazarr_version":"1.6.0"}}`))
				return
			}
			if f.badgesBody != "" {
				w.Write([]byte(f.badgesBody))
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"episodes": 0, "movies": 0, "providers": 0, "status": 0,
				"sonarr_signalr": "DOWN", "radarr_signalr": "DOWN", "announcements": 0,
			})
		})
	}
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	dir := t.TempDir()
	configDir := filepath.Join(dir, "config", "config")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "auth:\n  apikey: " + apiKey + "\n  type: null\n  username: \"\"\n  password: \"\"\n"
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return helpers.New(helpers.Config{
		App: "bazarr", Service: "bazarr", Dir: dir,
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeBazarr{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (bazarr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (bazarr.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if h.Secret(h.Key("api_key")) != apiKey {
		t.Fatal("Setup did not save the verified API credential")
	}
	if err := os.Remove(filepath.Join(h.Dir, "config", "config", "config.yaml")); err != nil {
		t.Fatal(err)
	}

	records = nil
	if err := (bazarr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if fake.settingsPosts != 1 {
		t.Fatal("rerun changed existing authentication settings")
	}
}

func TestAPIReadinessRejectsMissingFieldsAndAuthenticationErrors(t *testing.T) {
	for _, tc := range []struct {
		name       string
		status     int
		statusBody string
		badgesBody string
	}{
		{name: "rejected", status: http.StatusUnauthorized},
		{name: "unavailable", status: http.StatusServiceUnavailable},
		{name: "missing version", statusBody: `{"data":{}}`},
		{name: "missing badges", badgesBody: `{}`},
		{name: "null badge", badgesBody: `{"episodes":null,"movies":0,"providers":0,"status":0,"sonarr_signalr":"DOWN","radarr_signalr":"DOWN","announcements":0}`},
		{name: "negative badge", badgesBody: `{"episodes":-1,"movies":0,"providers":0,"status":0,"sonarr_signalr":"DOWN","radarr_signalr":"DOWN","announcements":0}`},
		{name: "HTML response", badgesBody: `<html>login</html>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeBazarr{user: adminUser, pass: adminPass, apiStatus: tc.status, statusBody: tc.statusBody, badgesBody: tc.badgesBody}
			srv := httptest.NewServer(fake.handler())
			t.Cleanup(srv.Close)
			var records []helpers.StepResult
			h := newH(t, srv, &records)
			if err := (bazarr.App{}).Setup(context.Background(), h); err == nil {
				t.Fatal("Setup accepted incomplete or rejected API data")
			}
			if h.Secret(h.Key("api_key")) != "" {
				t.Fatal("Setup saved an unverified credential")
			}
			if err := h.SetSecret(h.Key("api_key"), apiKey); err != nil {
				t.Fatal(err)
			}
			if err := (bazarr.App{}).Check(context.Background(), h); err == nil {
				t.Fatal("Check accepted incomplete or rejected API data")
			}
		})
	}
}

func TestSetupRecoversExternallyChangedKeyAndCheckProbesAfresh(t *testing.T) {
	fake := &fakeBazarr{user: adminUser, pass: adminPass}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	if err := h.SetSecret(h.Key("api_key"), "stale-test-key"); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := (bazarr.App{}).Setup(ctx, h); err != nil {
		t.Fatal(err)
	}
	if h.Secret(h.Key("api_key")) != apiKey || fake.settingsPosts != 0 {
		t.Fatal("Setup did not recover the current key without changing settings")
	}
	fake.mu.Lock()
	fake.key = "externally-changed-test-key"
	fake.mu.Unlock()
	if err := (bazarr.App{}).Check(ctx, h); err == nil {
		t.Fatal("Check reused cached authentication after a key change")
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeBazarr{failSet: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (bazarr.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the settings update errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "Settings") {
		t.Errorf("hint should name the Bazarr settings page, got %q", hint)
	}
}
