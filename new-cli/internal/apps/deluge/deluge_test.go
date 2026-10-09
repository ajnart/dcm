package deluge_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/deluge"
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

type fakeDeluge struct {
	mu       sync.Mutex
	password string
}

func (f *fakeDeluge) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Deluge</html>")) })
	mux.HandleFunc("POST /json", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var req struct {
			Method string   `json:"method"`
			Params []string `json:"params"`
			ID     int      `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		result := false
		switch req.Method {
		case "auth.login":
			if len(req.Params) == 1 && req.Params[0] == f.password {
				result = true
				http.SetCookie(w, &http.Cookie{Name: "_session_id", Value: "session"})
			}
		case "auth.change_password":
			if len(req.Params) == 2 && req.Params[0] == f.password &&
				r.Header.Get("Cookie") == "_session_id=session" {
				f.password = req.Params[1]
				result = true
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"result": result, "error": nil, "id": req.ID})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "deluge", Service: "deluge",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupRotatesTheInitialPasswordThenCheckAndRerunSkip(t *testing.T) {
	fake := &fakeDeluge{password: "deluge"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (deluge.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.password != adminPass {
		t.Fatalf("Setup did not rotate the Web password, got %q", fake.password)
	}
	if err := (deluge.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (deluge.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeDeluge{password: "changed-outside-setup"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (deluge.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when neither password works")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup deluge") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
