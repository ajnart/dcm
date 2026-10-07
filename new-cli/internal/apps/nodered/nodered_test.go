package nodered_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/nodered"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
	"golang.org/x/crypto/bcrypt"
)

const (
	adminUser = "admin"
	password  = "node-red-admin-password"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/login", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"type":"credentials"}`))
	})
	mux.HandleFunc("GET /flows", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`[]`))
	})
	mux.HandleFunc("POST /auth/token", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != adminUser || body.Password != password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"access_token": "token", "token_type": "Bearer", "expires_in": 3600})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "node-red", Service: "node-red",
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

	if err := (nodered.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (nodered.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := nodered.App{}
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
		App: "node-red", Service: "node-red",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": "wrong"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})

	err := (nodered.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-login step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-login" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != "fail" {
		t.Fatalf("admin-login did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}

func TestFilesWritesBcryptHashOfTheAdminLogin(t *testing.T) {
	secret := func(name string) string {
		return map[string]string{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": password}[name]
	}
	files := (nodered.App{}).Files(app.RenderContext{}, secret)
	if len(files) != 1 || files[0].Mode != 0o600 {
		t.Fatalf("Files = %+v, want one mode-0600 settings file", files)
	}
	if strings.Contains(files[0].Content, password) {
		t.Fatal("settings.js must not contain the plaintext password")
	}
	if !strings.Contains(files[0].Content, "username: '"+adminUser+"'") {
		t.Fatalf("settings.js lacks the Admin username:\n%s", files[0].Content)
	}
	const marker = "password: '"
	start := strings.Index(files[0].Content, marker)
	if start < 0 {
		t.Fatalf("settings.js has no password entry:\n%s", files[0].Content)
	}
	hash := files[0].Content[start+len(marker):]
	hash = hash[:strings.Index(hash, "'")]
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		t.Fatalf("embedded hash does not match the Admin login: %v", err)
	}
}
