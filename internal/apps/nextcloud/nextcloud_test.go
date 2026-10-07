package nextcloud_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/nextcloud"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeNextcloud struct {
	reject bool
}

func (f *fakeNextcloud) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status.php", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"installed": true})
	})
	mux.HandleFunc("GET /ocs/v1.php/cloud/users", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "secret-admin" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"ocs": map[string]any{
				"meta": map[string]any{"statuscode": 100},
				"data": map[string]any{"users": []string{"admin"}},
			},
		})
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
		App: "nextcloud", Service: "nextcloud",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "NEXTCLOUD_ADMIN_PASSWORD": "secret-admin"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (nextcloud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (nextcloud.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == "fail" {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (nextcloud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (nextcloud.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(*recorded) == 0 {
		t.Fatal("no steps recorded on rerun")
	}
	for _, r := range *recorded {
		if r.Status != "skip" {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedLoginHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeNextcloud{reject: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	err := (nextcloud.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup should fail when the administrator login is rejected")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == "fail" {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, srv.URL) {
		t.Fatalf("failing step hint should name the App page, got %+v", fail)
	}
}
