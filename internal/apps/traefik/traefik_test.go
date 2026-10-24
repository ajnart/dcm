package traefik_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/traefik"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
	"golang.org/x/crypto/bcrypt"
)

const (
	adminUser = "admin"
	password  = "traefik-control-password"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func authorized(r *http.Request) bool {
	user, pass, ok := r.BasicAuth()
	return ok && user == adminUser && pass == password
}

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"Version": "3.6.22"})
	})
	mux.HandleFunc("GET /api/http/routers", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode([]map[string]string{{"name": "selfhost-api@file", "status": "enabled"}})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "traefik", Service: "traefik",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": password},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})
}

func TestSetupCheckPass(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (traefik.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (traefik.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := traefik.App{}
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = nil
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range results {
		if r.ID == "ready" {
			continue
		}
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
}

func TestWrongPasswordFailsWithHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	deps := systemtest.NewDeps(t)
	h := helpers.New(helpers.Config{
		App: "traefik", Service: "traefik",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": "wrong"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})

	err := (traefik.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-api step")
	}
	if !strings.Contains(err.Error(), "saved management API credential probe returned HTTP 401") {
		t.Fatalf("wrong credential did not identify its fixed HTTP status: %v", err)
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-api" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != stepstatus.StepFail {
		t.Fatalf("admin-api did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}

func TestFilesWritesBcryptHashAndNeverMountsTheDockerSocket(t *testing.T) {
	compose := (traefik.App{}).Compose(app.RenderContext{Port: 8080})
	if strings.Contains(compose, "docker.sock") {
		t.Fatal("Compose must never mount the docker socket")
	}
	secret := func(name string) string {
		return map[string]string{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": password}[name]
	}
	files := (traefik.App{}).Files(app.RenderContext{}, secret)
	if len(files) != 1 || files[0].Mode != 0o600 {
		t.Fatalf("Files = %+v, want one mode-0600 dynamic config", files)
	}
	const marker = "'" + adminUser + ":"
	start := strings.Index(files[0].Content, marker)
	if start < 0 {
		t.Fatalf("dynamic config has no basic-auth user:\n%s", files[0].Content)
	}
	hash := files[0].Content[start+len(marker):]
	hash = hash[:strings.Index(hash, "'")]
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		t.Fatalf("embedded hash does not match the Admin login: %v", err)
	}
}

func TestSetupWaitsForAuthenticatedFileProviderAfterPing(t *testing.T) {
	api, routers := 0, 0
	real := handler()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("unexpected credential mutation: %s", r.Method)
		}
		switch r.URL.Path {
		case "/ping":
			w.WriteHeader(http.StatusOK)
			return
		case "/api/version":
			if !authorized(r) {
				api++
				if api <= 2 {
					w.WriteHeader(http.StatusNotFound)
					return
				}
			}
		case "/api/http/routers":
			routers++
			if routers <= 2 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
		}
		real.ServeHTTP(w, r)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	if err := (traefik.App{}).Setup(context.Background(), newH(t, srv, &results)); err != nil {
		t.Fatalf("Setup failed while file provider was still loading: %v", err)
	}
	if api < 3 || routers < 3 {
		t.Fatalf("file-provider/API router readiness was not verified: API=%d routers=%d", api, routers)
	}
}

func TestSetupRequiresSuccessfulPingBeforeManagementAPI(t *testing.T) {
	api := 0
	real := handler()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ping" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		api++
		real.ServeHTTP(w, r)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	err := (traefik.App{}).Setup(context.Background(), newH(t, srv, &results))
	if err == nil {
		t.Fatal("Setup accepted HTTP 404 ping as readiness")
	}
	if api != 0 {
		t.Fatalf("management API queried before successful ping: %d", api)
	}
}

func TestSetupRefusesAnonymousManagementAPIWithoutMutation(t *testing.T) {
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet {
			t.Fatalf("anonymous API caused credential mutation: %s", r.Method)
		}
		if r.URL.Path == "/ping" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"Version":"3.6.22"}`))
	}))
	defer srv.Close()
	var results []helpers.StepResult
	err := (traefik.App{}).Setup(context.Background(), newH(t, srv, &results))
	if err == nil || !strings.Contains(err.Error(), "anonymous") {
		t.Fatalf("want explicit anonymous-access refusal, got %v", err)
	}
	if requests > 4 {
		t.Fatalf("unsafe anonymous API was polled repeatedly: %d", requests)
	}
}

func TestCheckReportsFixedStatusAndContractFailures(t *testing.T) {
	for _, tc := range []struct {
		name         string
		status       int
		body, detail string
	}{
		{"wrong-credential", http.StatusUnauthorized, "synthetic-secret-response", "HTTP 401"},
		{"invalid-json", http.StatusOK, "synthetic-secret-response", "version JSON"},
		{"wrong-version", http.StatusOK, `{"Version":"synthetic-secret-response"}`, "Traefik 3.6.22 or newer"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !authorized(r) {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			var results []helpers.StepResult
			err := (traefik.App{}).Check(context.Background(), newH(t, srv, &results))
			if err == nil || !strings.Contains(err.Error(), tc.detail) {
				t.Fatalf("want fixed %s detail, got %v", tc.detail, err)
			}
			if strings.Contains(err.Error(), "synthetic-secret-response") {
				t.Fatalf("response leaked: %v", err)
			}
		})
	}
}

func TestSetupBoundsUnavailableFileProviderAndReportsStatus(t *testing.T) {
	api := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ping" {
			w.WriteHeader(http.StatusOK)
			return
		}
		api++
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("synthetic-secret-response"))
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	before := h.Now()
	err := (traefik.App{}).Setup(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "HTTP 404") || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("want bounded route status failure, got %v", err)
	}
	if h.Now().Sub(before) > 2*time.Minute+time.Second {
		t.Fatalf("management wait exceeded bound: %v", h.Now().Sub(before))
	}
	if api > 125 {
		t.Fatalf("management wait was unbounded: %d requests", api)
	}
	if strings.Contains(err.Error(), "synthetic-secret-response") {
		t.Fatal("route response leaked")
	}
}

func TestCheckReportsRouterContractFailureWithoutResponseData(t *testing.T) {
	for _, tc := range []struct {
		name         string
		status       int
		body, detail string
	}{
		{"route-not-ready", http.StatusNotFound, "synthetic-secret-response", "router probe returned HTTP 404"},
		{"invalid-router-json", http.StatusOK, "synthetic-secret-response", "invalid router JSON"},
		{"disabled-router", http.StatusOK, `[{"name":"selfhost-api@file","status":"disabled"}]`, "no enabled selfhost-api"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			real := handler()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/http/routers" {
					w.WriteHeader(tc.status)
					w.Write([]byte(tc.body))
					return
				}
				real.ServeHTTP(w, r)
			}))
			defer srv.Close()
			var results []helpers.StepResult
			err := (traefik.App{}).Check(context.Background(), newH(t, srv, &results))
			if err == nil || !strings.Contains(err.Error(), tc.detail) {
				t.Fatalf("want fixed router detail %s, got %v", tc.detail, err)
			}
			if strings.Contains(err.Error(), "synthetic-secret-response") {
				t.Fatal("router response leaked")
			}
		})
	}
}
