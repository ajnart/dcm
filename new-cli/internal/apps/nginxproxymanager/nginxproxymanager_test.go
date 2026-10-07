package nginxproxymanager_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/nginxproxymanager"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakeNPM struct {
	mu            sync.Mutex
	pending       bool
	email         string
	password      string
	rootRedirects int
	adminCreates  int
	setupBody     string
}

func (f *fakeNPM) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.rootRedirects++
		f.mu.Unlock()
		// Nginx expands the pinned slash redirect using its internal admin
		// port, which differs from this fixture's selected host port.
		http.Redirect(w, r, "http://127.0.0.1:81/api/", http.StatusFound)
	})
	mux.HandleFunc("GET /api/{$}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.setupBody != "" {
			w.Write([]byte(f.setupBody))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"status":  "OK",
			"setup":   !f.pending,
			"version": map[string]any{"major": 2, "minor": 16, "revision": 0},
		})
	})
	mux.HandleFunc("POST /api/users", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Email string `json:"email"`
			Auth  struct {
				Secret string `json:"secret"`
			} `json:"auth"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.adminCreates++
		f.pending, f.email, f.password = false, body.Email, body.Auth.Secret
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("POST /api/tokens", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Identity string `json:"identity"`
			Secret   string `json:"secret"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Identity != f.email || body.Secret != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"token": "bearer-token"})
	})
	mux.HandleFunc("GET /api/users/me", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer bearer-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"email": f.email, "roles": []string{"admin"}, "is_disabled": false, "id": 1})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	client := srv.Client()
	transport := client.Transport
	client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Scheme+"://"+req.URL.Host != srv.URL {
			return nil, errors.New("API request left the selected host origin")
		}
		return transport.RoundTrip(req)
	})
	return helpers.New(helpers.Config{
		App: "nginx-proxy-manager", Service: "nginx-proxy-manager",
		BaseURL: srv.URL, URL: srv.URL, HTTP: client,
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestSetupPreservesSelectedOriginThenCheckAndRerunSkips(t *testing.T) {
	fake := &fakeNPM{pending: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (nginxproxymanager.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.email != adminUser+"@selfhost.local" || fake.password != adminPass {
		t.Fatalf("Setup did not create the Admin login: %+v", fake)
	}
	if err := (nginxproxymanager.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (nginxproxymanager.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if err := (nginxproxymanager.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check after rerun: %v", err)
	}
	if fake.rootRedirects != 0 || fake.adminCreates != 1 {
		t.Fatalf("setup must keep the selected origin and create the admin once: redirects=%d creates=%d", fake.rootRedirects, fake.adminCreates)
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeNPM{pending: false, email: "existing@example.test", password: "existing-password"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (nginxproxymanager.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when an administrator already exists")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup nginx-proxy-manager") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
	if fake.adminCreates != 0 || fake.email != "existing@example.test" || fake.password != "existing-password" {
		t.Fatal("Setup changed the existing administrator")
	}
}

func TestSetupRejectsUnknownSetupStateWithoutCreatingAdmin(t *testing.T) {
	for _, body := range []string{`{"status":"OK"}`, `{"setup":null}`, `{"setup":"false"}`, `invalid`} {
		t.Run(body, func(t *testing.T) {
			fake := &fakeNPM{pending: true, setupBody: body}
			srv := httptest.NewServer(fake.handler())
			t.Cleanup(srv.Close)
			var records []helpers.StepResult
			if err := (nginxproxymanager.App{}).Setup(context.Background(), newH(t, srv, &records)); err == nil {
				t.Fatal("Setup accepted an unknown first-owner state")
			}
			if fake.adminCreates != 0 {
				t.Fatal("Setup created an administrator with an unknown setup state")
			}
		})
	}
}
