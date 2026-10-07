package audiobookshelf_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/audiobookshelf"
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

type fakeABS struct {
	mu       sync.Mutex
	password string
	failInit bool
}

func (f *fakeABS) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"app": "audiobookshelf", "serverVersion": "2.37.0", "isInit": f.password != ""})
	})
	mux.HandleFunc("POST /init", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failInit {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		var body struct {
			NewRoot struct{ Username, Password string } `json:"newRoot"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.NewRoot.Password
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != adminUser || body.Password != f.password || f.password == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"username": adminUser, "type": "root"}})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "audiobookshelf", Service: "audiobookshelf",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeABS{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (audiobookshelf.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (audiobookshelf.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !fake.passwordSet() {
		t.Fatal("Setup did not create the root account")
	}

	records = nil
	if err := (audiobookshelf.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != "skip" {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func (f *fakeABS) passwordSet() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.password != ""
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeABS{failInit: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (audiobookshelf.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when /init errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == "fail" {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup audiobookshelf") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
