package mayanedms_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/mayanedms"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeMayan struct {
	reject   bool
	disclose bool
}

func (f *fakeMayan) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /api/v4/users/current/", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": 1, "username": "admin", "is_active": true})
	})
	mux.HandleFunc("PATCH /api/v4/users/current/", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.disclose = false
		json.NewEncoder(w).Encode(map[string]any{"id": 1, "username": "admin", "is_active": true})
	})
	mux.HandleFunc("GET /authentication/login/", func(w http.ResponseWriter, r *http.Request) {
		body := "<html>Mayan EDMS login</html>"
		if f.disclose {
			body = "<html>password <strong>adminpass</strong></html>"
		}
		w.Write([]byte(body))
	})
	return mux
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server) (*helpers.H, *[]helpers.StepResult) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	var recorded []helpers.StepResult
	h := helpers.New(helpers.Config{
		App: "mayan-edms", Service: "mayan-edms",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakeMayan{disclose: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (mayanedms.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (mayanedms.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == stepstatus.StepFail {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestSetupClearsTheShownPassword(t *testing.T) {
	fake := &fakeMayan{disclose: true}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, _ := newH(t, srv)

	if err := (mayanedms.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.disclose {
		t.Error("Setup did not clear the disclosed password")
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeMayan{disclose: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (mayanedms.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (mayanedms.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedLoginHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeMayan{reject: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (mayanedms.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator login is rejected")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == stepstatus.StepFail {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, srv.URL) {
		t.Fatalf("failing step hint should name the App page, got %+v", fail)
	}
}
