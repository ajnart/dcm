package seafile_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/seafile"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSeafile struct {
	reject bool
}

func (f *fakeSeafile) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /api2/auth-token/", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if f.reject || r.PostForm.Get("username") != "admin@example.test" || r.PostForm.Get("password") != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"token": "abcdef0123456789abcdef0123456789abcdef01"})
	})
	mux.HandleFunc("GET /api/v2.1/admin/users/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer abcdef0123456789abcdef0123456789abcdef01" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"count": 1, "results": []any{}})
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
		App: "seafile", Service: "seafile",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakeSeafile{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (seafile.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (seafile.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == "fail" {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeSeafile{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (seafile.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (seafile.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != "skip" {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedLoginHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeSeafile{reject: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (seafile.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator login is rejected")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == "fail" {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, "self-host logs seafile") {
		t.Fatalf("failing step hint should name the App command, got %+v", fail)
	}
}
