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
type fakeEmby struct {
	reject  bool
	key     string
	created int
	hidden  bool
}

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
			"AccessToken": "test-session",
			"User":        map[string]any{"Id": "test-admin", "Name": adminUser, "Policy": map[string]any{"IsAdministrator": true}},
		})
	})
	mux.HandleFunc("GET /System/Configuration", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"IsStartupWizardCompleted": true})
	})
	mux.HandleFunc("POST /Sessions/Logout", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /Auth/Keys", func(w http.ResponseWriter, r *http.Request) {
		items := []map[string]any{}
		if f.key != "" {
			items = append(items, map[string]any{"AccessToken": f.key, "AppName": "self-host Homarr", "IsActive": true})
		}
		json.NewEncoder(w).Encode(map[string]any{"Items": items, "TotalRecordCount": len(items)})
	})
	mux.HandleFunc("POST /Auth/Keys", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("App") != "self-host Homarr" || r.Header.Get("X-Emby-Token") != "test-session" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.created++
		f.key = "test-api-key"
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /emby/System/Info", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != "test-session" && (f.key == "" || r.Header.Get("X-Emby-Token") != f.key) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"Id": "server-1", "Version": "4.10.0.40"})
	})
	mux.HandleFunc("GET /emby/Sessions", func(w http.ResponseWriter, r *http.Request) {
		if f.key == "" || r.Header.Get("X-Emby-Token") != f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{})
	})
	mux.HandleFunc("GET /Users/Public", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != f.key || f.key == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		users := []map[string]any{}
		if !f.hidden {
			users = append(users, map[string]any{"Id": "selected-user-47", "Name": "viewer"})
		}
		json.NewEncoder(w).Encode(users)
	})
	mux.HandleFunc("GET /Users/selected-user-47/Items/Latest", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Emby-Token") != f.key || r.URL.Query().Get("Limit") != "100" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode([]map[string]any{})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		Peer: func(string) *helpers.H { return &helpers.H{} },
		App:  "emby", Service: "emby",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupSkipsWhenTheWizardIsDoneAndCheckPasses(t *testing.T) {
	fake := &fakeEmby{}
	srv := httptest.NewServer(fake.handler())
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
	if fake.created != 1 || emby.APIKey(h) != "test-api-key" {
		t.Fatal("Setup should save and reuse one dedicated API key")
	}
	if err := emby.VerifyReleases(ctx, h); err != nil {
		t.Fatalf("authenticated empty latest media: %v", err)
	}
	fake.hidden = true
	if err := emby.VerifyReleases(ctx, h); err == nil {
		t.Fatal("hidden users should not become an invented release selection")
	}
	fake.key = "changed-api-key"
	if err := emby.VerifyHomarr(ctx, h); err == nil {
		t.Fatal("Check should freshly reject a revoked API key")
	}
	if err := (emby.App{}).Setup(ctx, h); err == nil {
		t.Fatal("Setup should not rotate a revoked API key")
	}
	if fake.created != 1 {
		t.Fatal("retry rotated the API key")
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
