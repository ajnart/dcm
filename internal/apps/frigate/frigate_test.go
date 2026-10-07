package frigate_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/frigate"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser  = "admin"
	adminPass  = "correct-horse-battery"
	tempPass   = "0123456789abcdef0123456789abcdef"
	frigateLog = `********************************************************
***    Auth is enabled, but no users exist.          ***
***    Created a default user:                       ***
***    User: admin                                   ***
***    Password: 0123456789abcdef0123456789abcdef   ***
********************************************************`
)

type fakeFrigate struct {
	mu       sync.Mutex
	password string
	token    string
	failPut  bool
}

func (f *fakeFrigate) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /api/profile", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ User, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.User != adminUser || body.Password != f.password || f.password == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		token := "token-" + body.Password
		f.token = token
		http.SetCookie(w, &http.Cookie{Name: "frigate_token", Value: token, Path: "/"})
	})
	mux.HandleFunc("PUT /api/users/admin/password", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failPut {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		if cookie, err := r.Cookie("frigate_token"); err != nil || cookie.Value != f.token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body struct{ Password string }
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.Password
		json.NewEncoder(w).Encode(map[string]any{"success": true})
	})
	return mux
}

type fakeExec struct{}

func (fakeExec) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	return system.Result{}, nil
}
func (fakeExec) LogText(context.Context, int, ...string) (string, error) { return frigateLog, nil }
func (fakeExec) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "frigate", Service: "frigate",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep, Exec: fakeExec{},
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeFrigate{password: tempPass}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (frigate.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (frigate.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if fake.password != adminPass {
		t.Fatal("Setup did not rotate to the saved Admin password")
	}

	records = nil
	if err := (frigate.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheContainerLogs(t *testing.T) {
	fake := &fakeFrigate{password: tempPass, failPut: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (frigate.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the rotation write errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host logs frigate") {
		t.Errorf("hint should name the logs command, got %q", hint)
	}
}
