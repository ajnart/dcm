package adguard_test

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/adguard"
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

type fakeAdGuard struct {
	mu            sync.Mutex
	configured    bool
	password      string
	failInstall   bool
	installCalls  int
	statusHTTP    int
	statusBody    string
	profileHTTP   int
	profileBody   string
	filteringBody string
	statsBody     string
}

func (f *fakeAdGuard) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /control/status", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		f.mu.Lock()
		defer f.mu.Unlock()
		if !ok || !f.configured || user != adminUser || pass != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.statusHTTP != 0 {
			w.WriteHeader(f.statusHTTP)
			return
		}
		if f.statusBody != "" {
			w.Write([]byte(f.statusBody))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"version": "v0.107.79", "running": true, "dns_port": 53, "http_port": 3000})
	})
	mux.HandleFunc("GET /control/profile", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		f.mu.Lock()
		defer f.mu.Unlock()
		if !ok || !f.configured || user != adminUser || pass != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.profileHTTP != 0 {
			if f.profileHTTP == http.StatusFound {
				w.Header().Set("Location", "/control/install.html")
			}
			w.WriteHeader(f.profileHTTP)
			return
		}
		if f.profileBody != "" {
			w.Write([]byte(f.profileBody))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"name": user})
	})
	mux.HandleFunc("GET /control/stats", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.statsBody != "" {
			w.Write([]byte(f.statsBody))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"time_units": "days", "dns_queries": []int{0}, "blocked_filtering": []int{0},
			"num_dns_queries": 0, "num_blocked_filtering": 0,
		})
	})
	mux.HandleFunc("GET /control/filtering/status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.filteringBody != "" {
			w.Write([]byte(f.filteringBody))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"filters": nil})
	})
	mux.HandleFunc("GET /control/install/get_addresses", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.configured {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"version": "v0.107.79"})
	})
	mux.HandleFunc("POST /control/install/configure", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.installCalls++
		if f.failInstall {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.configured, f.password = true, body.Password
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		configured := f.configured
		f.mu.Unlock()
		path := r.URL.Path
		if !configured && path != "/install.html" && !strings.HasPrefix(path, "/control/install/") {
			http.Redirect(w, r, "install.html", http.StatusFound)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "adguard-home", Service: "adguard-home",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeAdGuard{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (adguard.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if !fake.configured {
		t.Fatal("Setup did not configure the administrator")
	}
	if err := (adguard.App{}).Check(ctx, h); err != nil {
		t.Errorf("Check: %v", err)
	}

	records = nil
	if err := (adguard.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}

	for _, body := range []string{`{"filters": null}`, `{"filters": []}`, `{"filters": [{"enabled": false, "rules_count": 0}]}`} {
		fake.mu.Lock()
		fake.filteringBody = body
		fake.mu.Unlock()
		if err := (adguard.App{}).Check(ctx, h); err != nil {
			t.Errorf("valid empty/zero filtering response %s: %v", body, err)
		}
	}
	for _, body := range []string{`{}`, `{"filters":`, `{"filters": 0}`, `{"filters": {}}`, `{"filters": [null]}`, `{"filters": [{}]}`, `{"filters": [{"enabled": true}]}`, `{"filters": [{"rules_count": 0}]}`, `{"filters": [{"enabled": "false", "rules_count": 0}]}`, `{"filters": [{"enabled": true, "rules_count": "0"}]}`, `{"filters": [{"enabled": true, "rules_count": -1}]}`} {
		fake.mu.Lock()
		fake.filteringBody = body
		fake.mu.Unlock()
		if err := (adguard.App{}).Check(ctx, h); err == nil {
			t.Errorf("invalid filtering response accepted: %s", body)
		}
	}
	fake.mu.Lock()
	fake.filteringBody = ""
	fake.statsBody = `{"time_units": "days", "dns_queries": [], "blocked_filtering": [], "num_dns_queries": 0, "num_blocked_filtering": 0}`
	fake.mu.Unlock()
	if err := (adguard.App{}).Check(ctx, h); err != nil {
		t.Errorf("valid empty statistics: %v", err)
	}
	for _, body := range []string{`{}`, `{"time_units": "days", "dns_queries": null, "blocked_filtering": [], "num_dns_queries": 0, "num_blocked_filtering": 0}`, `{"time_units": "days", "dns_queries": [], "blocked_filtering": [], "num_blocked_filtering": 0}`} {
		fake.mu.Lock()
		fake.statsBody = body
		fake.mu.Unlock()
		if err := (adguard.App{}).Check(ctx, h); err == nil {
			t.Errorf("invalid statistics accepted: %s", body)
		}
	}
	fake.mu.Lock()
	fake.statsBody = ""
	fake.statusHTTP = http.StatusInternalServerError
	fake.mu.Unlock()
	records = nil
	if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "DNS status returned HTTP 500") {
		t.Errorf("DNS failure lost during Setup: %v", err)
	}
	for _, r := range records {
		if r.ID == "admin" && r.Status != stepstatus.StepSkip {
			t.Errorf("valid Admin login did not skip during DNS failure: %+v", r)
		}
		if r.Status == stepstatus.StepFail && (r.ID != "dns-api" || !strings.Contains(r.Hint, "self-host logs adguard-home") || strings.Contains(r.Hint, "administrator")) {
			t.Errorf("DNS failure used account recovery: %+v", r)
		}
	}
	fake.mu.Lock()
	fake.statusHTTP = 0
	fake.mu.Unlock()
	for _, body := range []string{`{}`, `{"version": "v0.107.79", "dns_port": 53, "http_port": 3000}`, `{"version": "v0.107.79", "running": false, "dns_port": 53, "http_port": 3000}`} {
		fake.mu.Lock()
		fake.statusBody = body
		fake.mu.Unlock()
		if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "adguard-home: dns-api:") {
			t.Errorf("invalid DNS status did not fail its own step: %s: %v", body, err)
		}
	}
	fake.mu.Lock()
	fake.statusBody = ""
	fake.profileHTTP = http.StatusInternalServerError
	fake.mu.Unlock()
	records = nil
	if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "Admin profile returned HTTP 500") {
		t.Errorf("profile server failure lost during Setup: %v", err)
	}
	for _, r := range records {
		if r.Status == stepstatus.StepManual || strings.Contains(r.Hint, "create the administrator") || (r.ID == "admin" && !strings.Contains(r.Error, "Admin profile returned HTTP 500")) {
			t.Errorf("profile server failure entered account recovery: %+v", r)
		}
	}
	for _, code := range []int{http.StatusForbidden, http.StatusFound} {
		fake.mu.Lock()
		fake.profileHTTP = code
		fake.mu.Unlock()
		if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "Admin profile returned HTTP") || strings.Contains(err.Error(), "login was rejected") {
			t.Errorf("unexpected profile status entered account recovery: HTTP %d: %v", code, err)
		}
	}
	fake.mu.Lock()
	fake.profileHTTP = 0
	fake.mu.Unlock()
	for _, body := range []string{`<html>install</html>`, `{}`, `{"name": ""}`, `{"name": "someone-else"}`} {
		fake.mu.Lock()
		fake.profileBody = body
		fake.mu.Unlock()
		if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "authenticated Admin profile") || strings.Contains(err.Error(), "login was rejected") {
			t.Errorf("invalid profile entered account recovery: %s: %v", body, err)
		}
	}
	fake.mu.Lock()
	fake.profileBody = ""
	fake.mu.Unlock()
	client := h.Config.HTTP
	h.Config.HTTP = &http.Client{Transport: &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("fixture transport unavailable")
	}}}
	if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "fixture transport unavailable") || strings.Contains(err.Error(), "Admin login does not sign in") {
		t.Errorf("transport failure entered account recovery: %v", err)
	}
	h.Config.HTTP = client
	if err := (adguard.App{}).Setup(ctx, h); err != nil {
		t.Errorf("recovered Setup: %v", err)
	}
	fake.mu.Lock()
	fake.password = "other-existing-password"
	fake.mu.Unlock()
	if err := (adguard.App{}).Setup(ctx, h); err == nil || !strings.Contains(err.Error(), "login was rejected") || !strings.Contains(err.Error(), "without replacing DNS settings") {
		t.Errorf("credential rejection lost its targeted recovery: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.installCalls != 1 || fake.password != "other-existing-password" {
		t.Errorf("failure recovery changed the existing account: installs=%d", fake.installCalls)
	}
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeAdGuard{failInstall: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (adguard.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the install endpoint errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup adguard-home") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
