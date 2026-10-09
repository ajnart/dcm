package emby_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/emby"
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

// fakeEmby has the first-owner wizard already completed, as it must be before
// headless setup can verify the login.
type fakeEmby struct{ reject bool }

func (f *fakeEmby) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /System/Info/Public", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"Version": "4.10.0.40", "Id": "server-1"})
	})
	mux.HandleFunc("POST /Users/AuthenticateByName", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if f.reject || r.PostForm.Get("Username") != adminUser || r.PostForm.Get("Pw") != adminPass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"User": map[string]any{"Name": adminUser, "Policy": map[string]any{"IsAdministrator": true}},
		})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "emby", Service: "emby",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupSkipsWhenTheWizardIsDoneAndCheckPasses(t *testing.T) {
	srv := httptest.NewServer((&fakeEmby{}).handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (emby.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (emby.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (emby.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestManualHintNamesTheAdminCredentialCommand(t *testing.T) {
	srv := httptest.NewServer((&fakeEmby{reject: true}).handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (emby.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail while the first-owner wizard is unfinished")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepManual {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host credentials") {
		t.Errorf("hint should name the credentials command, got %q", hint)
	}
}
