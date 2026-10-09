package stalwartmail_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/stalwartmail"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html>Stalwart admin</html>"))
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "stalwart-mail", Service: "stalwart-mail", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestAdminUIReadinessDoesNotCompleteBrowserAdministrator(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"STALWART_HOSTNAME": "mail.example.com", "STALWART_DOMAIN": "example.com"})
	ctx := context.Background()

	if err := (stalwartmail.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "has no headless way") {
		t.Fatalf("Setup = %v, want manual administrator boundary", err)
	}
	if err := (stalwartmail.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check = %v, want successful probe", err)
	}
	records = nil
	if err := (stalwartmail.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "has no headless way") {
		t.Fatalf("rerun Setup = %v, want manual administrator boundary", err)
	}
	manual := false
	for _, r := range records {
		if r.ID == "admin" {
			manual = r.Status == stepstatus.StepManual && r.Error == "" && strings.Contains(r.Hint, srv.URL) && strings.Contains(r.Hint, "first-run wizard") && strings.Contains(r.Hint, "admin@example.com")
		}
		if r.ID == "admin-ui" && r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if !manual {
		t.Fatalf("administrator failure/hint missing: %+v", records)
	}
}

func TestMissingHostnameFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, nil)

	if err := (stalwartmail.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the hostname and domain")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "STALWART_HOSTNAME") {
		t.Errorf("hint should name the required input, got %q", hint)
	}
}

func TestCheckPassesWhenAdminUIAnswers(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"STALWART_HOSTNAME": "mail.example.com", "STALWART_DOMAIN": "example.com"})
	if err := (stalwartmail.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check = %v, want successful admin UI probe", err)
	}
}
