package traefik_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/traefik"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
	"golang.org/x/crypto/bcrypt"
)

const appPassword = "traefik-control-password"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func authorized(r *http.Request) bool {
	user, pass, ok := r.BasicAuth()
	return ok && user == "admin" && pass == appPassword
}

func handler() http.Handler {
	mux := http.NewServeMux()
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
		Secrets: secrets{"ADMIN_USER": "admin", "TRAEFIK_ADMIN_PASSWORD": appPassword},
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
		if r.ID == "wait" {
			continue
		}
		if r.Status != "skip" {
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
		Secrets: secrets{"ADMIN_USER": "admin", "TRAEFIK_ADMIN_PASSWORD": "wrong"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})

	err := (traefik.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-api step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-api" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != "fail" {
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
	files := (traefik.App{}).Files(app.RenderContext{}, func(string) string { return appPassword })
	if len(files) != 1 || files[0].Mode != 0o600 {
		t.Fatalf("Files = %+v, want one mode-0600 dynamic config", files)
	}
	const marker = "'admin:"
	start := strings.Index(files[0].Content, marker)
	if start < 0 {
		t.Fatalf("dynamic config has no basic-auth user:\n%s", files[0].Content)
	}
	hash := files[0].Content[start+len(marker):]
	hash = hash[:strings.Index(hash, "'")]
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(appPassword)); err != nil {
		t.Fatalf("embedded hash does not match the secret: %v", err)
	}
}
