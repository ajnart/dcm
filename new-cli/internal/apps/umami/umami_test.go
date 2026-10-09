package umami_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/umami"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeUmami struct {
	rotated   bool
	generated string
	rejectAll bool
}

func (f *fakeUmami) identity(token string) map[string]any {
	return map[string]any{
		"token": token,
		"user": map[string]any{
			"id": "a1b2c3d4-0000-4000-8000-000000000000", "username": "admin",
			"role": "admin", "isAdmin": true,
		},
	}
}

func (f *fakeUmami) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if f.rejectAll {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case body.Password == "umami" && !f.rotated:
			json.NewEncoder(w).Encode(f.identity("seed-token"))
		case body.Password != "" && body.Password == f.generated:
			json.NewEncoder(w).Encode(f.identity("gen-token"))
		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("POST /api/users/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer seed-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.generated = body.Password
		f.rotated = true
		w.WriteHeader(http.StatusOK)
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
		App: "umami", Service: "umami",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	fake := &fakeUmami{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (umami.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if !fake.rotated {
		t.Fatal("Setup did not rotate the seeded administrator password")
	}
	if err := (umami.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == stepstatus.StepFail {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeUmami{}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (umami.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (umami.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedRotationHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeUmami{rejectAll: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (umami.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when both the seeded and generated passwords are rejected")
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
