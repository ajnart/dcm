package passbolt_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/passbolt"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

type fakeExec struct{ keyless bool }

func (f fakeExec) Exec(_ context.Context, service string, _ map[string]string, command ...string) (system.Result, error) {
	if service != "passbolt" || len(command) == 0 || command[0] != "curl" || command[len(command)-1] != "https://127.0.0.1/auth/verify.json" || f.keyless {
		return system.Result{ExitCode: 22}, errors.New("exit status 22")
	}
	out, _ := json.Marshal(map[string]any{
		"header": map[string]any{"status": "success"},
		"body":   map[string]any{"fingerprint": strings.Repeat("AB", 20), "keydata": "-----BEGIN PGP PUBLIC KEY BLOCK-----"},
	})
	return system.Result{Stdout: out}, nil
}

func (fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (fakeExec) Restart(context.Context, ...string) error                { return nil }
func (fakeExec) Up(context.Context, ...string) error                     { return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /auth/verify.json", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://passbolt.example.com/auth/verify.json", http.StatusFound)
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, exec fakeExec, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "passbolt", Service: "passbolt", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs: inputs, Exec: exec,
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "correct-horse-battery"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func inputs() map[string]string {
	return map[string]string{
		"PASSBOLT_CANONICAL_ORIGIN": "https://passbolt.example.com",
		"PASSBOLT_SMTP_HOST":        "smtp.example.com",
	}
}

func TestServerKeyReadinessDoesNotCompleteBrowserEnrollment(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, fakeExec{}, &records, inputs())
	ctx := context.Background()

	if err := (passbolt.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "has no headless way") {
		t.Fatalf("Setup = %v, want manual browser enrollment", err)
	}
	if err := (passbolt.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check = %v, want successful probe", err)
	}
	records = nil
	if err := (passbolt.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "has no headless way") {
		t.Fatalf("rerun Setup = %v, want manual browser enrollment", err)
	}
	manual := false
	for _, r := range records {
		if r.ID == "admin" {
			manual = r.Status == stepstatus.StepManual && r.Error == "" && strings.Contains(r.Hint, srv.URL) && strings.Contains(r.Hint, "browser extension") && strings.Contains(r.Hint, "recovery kit")
		}
		if r.ID == "server-key" && r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if !manual {
		t.Fatalf("browser enrollment failure/hint missing: %+v", records)
	}
}

func TestMissingConfigurationFailsWithAHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, fakeExec{}, &records, nil)

	if err := (passbolt.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail without the origin and relay")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host install passbolt --yes --set") || !strings.Contains(hint, "PASSBOLT_CANONICAL_ORIGIN") {
		t.Errorf("hint should name the required input, got %q", hint)
	}
}

func TestMissingServerKeyFailsTheCheck(t *testing.T) {
	srv := httptest.NewServer(handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, fakeExec{keyless: true}, &records, inputs())

	if err := (passbolt.App{}).Check(context.Background(), h); err == nil {
		t.Fatal("Check should fail when the server key is absent")
	}
}

func TestCheckPassesWhenServerKeyWorks(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var records []helpers.StepResult
	h := newH(t, srv, fakeExec{}, &records, inputs())
	if err := (passbolt.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check = %v, want successful server-key probe", err)
	}
}
