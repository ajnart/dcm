package tracearr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/tracearr"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeTracearr struct {
	needsSetup  bool
	password    string
	rejectOwner bool
	startup     int
	maintenance bool
	creates     int
	health      string
}

func (f *fakeTracearr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		if f.health != "" {
			w.Write([]byte(f.health))
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "mode": "ready"})
	})
	mux.HandleFunc("GET /api/v1/setup/status", func(w http.ResponseWriter, r *http.Request) {
		if f.maintenance || f.startup > 0 {
			if f.startup > 0 {
				f.startup--
			}
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"needsSetup": f.needsSetup, "requiresClaimCode": false,
			"authMethods": map[string]bool{"local": true},
		})
	})
	mux.HandleFunc("POST /api/v1/auth/sign-up/email", func(w http.ResponseWriter, r *http.Request) {
		f.creates++
		if f.rejectOwner {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.Password
		f.needsSetup = false
		json.NewEncoder(w).Encode(map[string]string{"userId": "a1b2c3d4-0000-4000-8000-000000000000"})
	})
	mux.HandleFunc("POST /api/v1/auth/sign-in/username", func(w http.ResponseWriter, r *http.Request) {
		if f.maintenance || f.startup > 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if f.needsSetup || body.Username != "admin" || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"token": "bearer-for-admin"})
	})
	mux.HandleFunc("GET /api/v1/auth/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer bearer-for-admin" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"username": "admin", "email": "admin@selfhost.local", "role": "owner",
			"userId": "a1b2c3d4-0000-4000-8000-000000000000",
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
		App: "tracearr", Service: "tracearr",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := httptest.NewServer((&fakeTracearr{needsSetup: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (tracearr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (tracearr.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == "fail" {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
}

func TestSetupWaitsForSetupAPIToLeaveMaintenance(t *testing.T) {
	fake := &fakeTracearr{needsSetup: true, startup: 3}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, _ := newH(t, srv)
	ctx := context.Background()
	if err := (tracearr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup while the API warms: %v", err)
	}
	if err := (tracearr.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if fake.startup != 0 || fake.creates != 1 {
		t.Fatalf("startup remaining = %d, owner creations = %d", fake.startup, fake.creates)
	}
}

func TestSetupMaintenanceTimeoutHasRecoveryHint(t *testing.T) {
	fake := &fakeTracearr{needsSetup: true, maintenance: true}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	err := (tracearr.App{}).Setup(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "HTTP 503") {
		t.Fatalf("Setup should report the maintenance status, got %v", err)
	}
	if fake.creates != 0 {
		t.Fatalf("created %d owners while the API was unavailable", fake.creates)
	}
	if len(*recorded) != 1 {
		t.Fatalf("expected only the readiness failure, got %+v", *recorded)
	}
	fail := (*recorded)[0]
	if fail.ID != "ready" || fail.Status != "fail" ||
		!strings.Contains(fail.Hint, "/api/v1/setup/status") ||
		!strings.Contains(fail.Hint, "self-host logs tracearr") {
		t.Fatalf("missing readiness recovery hint: %+v", fail)
	}
	if strings.Contains(err.Error()+fail.Error+fail.Hint, "adminpass") {
		t.Fatal("readiness diagnostics exposed the password")
	}
}

func TestMaintenanceFailureReportsOnlyFixedPublicStartupSignals(t *testing.T) {
	fake := &fakeTracearr{needsSetup: true, maintenance: true, health: `{"mode":"maintenance","db":false,"redis":true,"initStep":null,"migrationError":"synthetic-private-secret","restore":{"private":"synthetic-private-secret"}}`}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	err := (tracearr.App{}).Setup(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "mode=maintenance db=unavailable redis=ready init=none") {
		t.Fatal("maintenance failure did not explain the public dependency state")
	}
	var observed bool
	for _, step := range *recorded {
		if step.ID == "startup-status" && step.Status == "fail" && strings.Contains(step.Error, "db=unavailable") {
			observed = true
		}
		if strings.Contains(step.Error+step.Hint, "synthetic-private") {
			t.Fatal("raw health response entered diagnostics")
		}
	}
	if !observed || strings.Contains(err.Error(), "synthetic-private") || fake.creates != 0 {
		t.Fatal("public startup observation missing, unsafe, or created an owner")
	}
}

func TestMaintenanceStatusAllowListsInitializationPhase(t *testing.T) {
	for _, tc := range []struct{ phase, want string }{{"migrations", "migrations"}, {"timescale", "timescale"}, {"services", "services"}, {"synthetic-private-secret", "unrecognized"}} {
		t.Run(tc.want, func(t *testing.T) {
			fake := &fakeTracearr{needsSetup: true, maintenance: true, health: `{"status":"maintenance","mode":"maintenance","db":true,"redis":true,"initStep":"` + tc.phase + `","migrationError":"synthetic-private-secret"}`}
			srv := httptest.NewServer(fake.handler())
			defer srv.Close()
			h, recorded := newH(t, srv)
			err := (tracearr.App{}).Setup(context.Background(), h)
			if err == nil || !strings.Contains(err.Error(), "db=ready redis=ready init="+tc.want) || strings.Contains(err.Error(), "synthetic-private") {
				t.Fatal("pinned public phase was not reported safely")
			}
			for _, step := range *recorded {
				if strings.Contains(step.Error+step.Hint, "synthetic-private") {
					t.Fatal("unknown health value entered evidence")
				}
			}
		})
	}
}

func TestSetupAfterMaintenancePreservesExistingOwner(t *testing.T) {
	for _, password := range []string{"adminpass", "existing-password"} {
		t.Run(password, func(t *testing.T) {
			fake := &fakeTracearr{password: password, startup: 3}
			srv := httptest.NewServer(fake.handler())
			defer srv.Close()
			h, _ := newH(t, srv)
			err := (tracearr.App{}).Setup(context.Background(), h)
			if password == "adminpass" {
				if err != nil {
					t.Fatalf("Setup with the existing login: %v", err)
				}
				if err := (tracearr.App{}).Check(context.Background(), h); err != nil {
					t.Fatalf("Check existing owner: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), "an administrator already exists") {
				t.Fatalf("Setup should refuse to replace an existing owner, got %v", err)
			}
			if fake.creates != 0 || fake.password != password {
				t.Fatalf("existing owner changed: creates = %d", fake.creates)
			}
		})
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer((&fakeTracearr{needsSetup: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (tracearr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (tracearr.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != "skip" {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
}

func TestFailedCreateHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakeTracearr{needsSetup: true, rejectOwner: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (tracearr.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the first-owner write fails")
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
