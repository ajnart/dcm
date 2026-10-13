package firstadmin_test

import (
	"context"
	"errors"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/firstadmin"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

const adminPassword = "Pa55word-long"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App:     "demo",
		Service: "demo",
		BaseURL: srv.URL,
		URL:     srv.URL,
		HTTP:    srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": adminPassword},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

func okServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
}

func statusOf(results []helpers.StepResult, id string) stepstatus.Step {
	var status stepstatus.Step
	for _, r := range results {
		if r.ID == id {
			status = r.Status
		}
	}
	return status
}

func assertNoSecret(t *testing.T, secret string, err error, results []helpers.StepResult) {
	t.Helper()
	if err != nil && strings.Contains(err.Error(), secret) {
		t.Errorf("returned error leaked the password: %v", err)
	}
	for _, r := range results {
		if strings.Contains(r.ID+string(r.Status)+r.Msg+r.Error+r.Hint, secret) {
			t.Errorf("step result leaked the password: %+v", r)
		}
	}
}

func TestNoAccountOKOn200(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	n := firstadmin.NoAccount{}

	err := n.Setup(context.Background(), h)
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if got := statusOf(results, "ready"); got != stepstatus.StepSkip {
		t.Errorf("ready status = %q, want skip (already serving)", got)
	}
	if err := n.Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestNoAccountWantAndContains(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("hello world"))
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()

	cases := []struct {
		name string
		p    firstadmin.Probe
		want bool
	}{
		{"contains present", firstadmin.Probe{Contains: "hello"}, true},
		{"contains missing", firstadmin.Probe{Contains: "goodbye"}, false},
		{"want matches", firstadmin.Probe{Want: []int{http.StatusOK}}, true},
		{"want mismatches", firstadmin.Probe{Want: []int{http.StatusCreated}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := firstadmin.NoAccount{Probe: tc.p}.Check(ctx, h)
			if tc.want && err != nil {
				t.Fatalf("Check = %v, want nil", err)
			}
			if !tc.want && err == nil {
				t.Fatal("Check = nil, want error")
			}
		})
	}
}

func TestNoAccountEmptyWantAcceptsAny2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	if err := (firstadmin.NoAccount{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestNoAccountTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	n := firstadmin.NoAccount{Probe: firstadmin.Probe{Timeout: 30 * time.Second}}

	err := n.Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want timeout error")
	}
	if !errors.Is(err, helpers.ErrStepFailed) {
		t.Errorf("error %v does not wrap ErrStepFailed", err)
	}
	if got := statusOf(results, "ready"); got != stepstatus.StepFail {
		t.Errorf("ready status = %q, want fail", got)
	}
	if len(results) != 1 || !strings.Contains(results[0].Hint, "self-host logs demo") {
		t.Errorf("hint = %q, want mention of self-host logs demo", results[0].Hint)
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestNoAccount503Then200(t *testing.T) {
	var mu sync.Mutex
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		n := requests
		mu.Unlock()
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	n := firstadmin.NoAccount{Probe: firstadmin.Probe{Timeout: time.Minute}}

	if err := n.Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if got := statusOf(results, "ready"); got != stepstatus.StepOK {
		t.Errorf("ready status = %q, want ok", got)
	}
	mu.Lock()
	polls := requests
	mu.Unlock()
	if polls < 3 {
		t.Errorf("server saw %d requests, want at least 3 (polling)", polls)
	}
}

type adminState struct {
	mu      sync.Mutex
	exists  bool
	user    string
	pass    string
	creates int
}

func (s *adminState) has(context.Context, *helpers.H) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exists, nil
}

func (s *adminState) make(_ context.Context, _ *helpers.H, user, password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.creates++
	s.user, s.pass, s.exists = user, password, true
	return nil
}

func (s *adminState) signIn(_ context.Context, _ *helpers.H, user, password string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exists && user == s.user && password == s.pass, nil
}

func (s *adminState) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.creates
}

func TestFirstAdminCreatesOnce(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	st := &adminState{}
	f := firstadmin.FirstAdmin{Ready: firstadmin.Probe{}, Exists: st.has, Create: st.make, Login: st.signIn}

	err := f.Setup(context.Background(), h)
	if err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if st.count() != 1 {
		t.Fatalf("Create called %d times, want 1", st.count())
	}
	if st.user != "admin" || st.pass != adminPassword {
		t.Errorf("Create got %q/%q, want the Admin login", st.user, st.pass)
	}
	if got := statusOf(results, "admin"); got != stepstatus.StepOK {
		t.Errorf("admin status = %q, want ok", got)
	}
	if err := f.Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestFirstAdminChecksResolvedUsername(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	st := &adminState{}
	f := firstadmin.FirstAdmin{
		Username: func(context.Context, *helpers.H) (string, error) { return "selfhost-admin", nil },
		Exists:   st.has, Create: st.make, Login: st.signIn,
	}
	if err := f.Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := f.Check(context.Background(), h); err != nil {
		t.Fatalf("Check did not use the resolved username: %v", err)
	}
}

func TestFirstAdminRerunSkips(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	st := &adminState{}
	f := firstadmin.FirstAdmin{Ready: firstadmin.Probe{}, Exists: st.has, Create: st.make, Login: st.signIn}

	if err := f.Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = nil
	err := f.Setup(context.Background(), h)
	if err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if st.count() != 1 {
		t.Errorf("Create called %d times, want 1", st.count())
	}
	if got := statusOf(results, "admin"); got != stepstatus.StepSkip {
		t.Errorf("admin status = %q, want skip", got)
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestFirstAdminAlreadyExists(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	st := &adminState{exists: true, user: "admin", pass: "another-password"}
	f := firstadmin.FirstAdmin{Ready: firstadmin.Probe{}, Exists: st.has, Create: st.make, Login: st.signIn}

	err := f.Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want already-exists error")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %v, want mention of already exists", err)
	}
	if st.count() != 0 {
		t.Errorf("Create called %d times, want 0", st.count())
	}
	if got := statusOf(results, "admin"); got != stepstatus.StepFail {
		t.Errorf("admin status = %q, want fail", got)
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestFirstAdminCreateNil(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	st := &adminState{}
	f := firstadmin.FirstAdmin{Ready: firstadmin.Probe{}, Exists: st.has, Login: st.signIn}

	err := f.Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want no-headless-way error")
	}
	if !strings.Contains(err.Error(), "no headless way") {
		t.Errorf("error = %v, want mention of no headless way", err)
	}
	if len(results) != 2 {
		t.Fatalf("recorded %d steps, want 2", len(results))
	}
	hint := results[1].Hint
	if !strings.Contains(hint, srv.URL) || !strings.Contains(hint, "self-host credentials") {
		t.Errorf("hint = %q, want the URL and self-host credentials", hint)
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestFirstAdminValidRejects(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	st := &adminState{}
	f := firstadmin.FirstAdmin{
		Ready:  firstadmin.Probe{},
		Exists: st.has,
		Create: st.make,
		Login:  st.signIn,
		Valid:  func(user, password string) error { return errors.New("the App refuses that password") },
	}

	err := f.Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want Valid error")
	}
	if !strings.Contains(err.Error(), "refuses that password") {
		t.Errorf("error = %v, want the Valid error", err)
	}
	if st.count() != 0 {
		t.Errorf("Create called %d times, want 0", st.count())
	}
	assertNoSecret(t, adminPassword, err, results)
}

func TestKinds(t *testing.T) {
	kinds := firstadmin.Kinds()
	if len(kinds) != 2 {
		t.Fatalf("Kinds() = %v, want 2 entries", kinds)
	}
	seen := map[string]bool{}
	for _, k := range kinds {
		seen[k] = true
	}
	if !seen[firstadmin.KindNoAccount] || !seen[firstadmin.KindManualFirstAdmin] {
		t.Errorf("Kinds() = %v, want both helper kinds", kinds)
	}
}

func TestFirstAdminRecordsManualStep(t *testing.T) {
	srv := okServer()
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	err := (firstadmin.FirstAdmin{Manual: "finish in the browser"}).Setup(context.Background(), h)
	if got := statusOf(results, "admin"); got != stepstatus.StepManual {
		t.Fatalf("admin status = %q, want manual", got)
	}
	if err == nil {
		t.Fatal("manual Setup must remain unfinished")
	}
	for _, r := range results {
		if r.ID == "admin" && (r.Error != "" || !strings.Contains(r.Hint, "finish in the browser")) {
			t.Fatalf("manual handoff = %+v", r)
		}
	}
}

func TestAuthenticatedProbeUsesResolvedRequestAndPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if r.URL.Path != "/protected" || !ok || user != "admin" || password != adminPassword {
			t.Error("readiness did not resolve its path and Shared Admin credentials")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Location", "/unexpected-redirect")
		w.WriteHeader(http.StatusFound)
		w.Write([]byte("private readiness"))
	}))
	t.Cleanup(server.Close)
	var results []helpers.StepResult
	h := newH(t, server, &results)
	admin := firstadmin.FirstAdmin{
		Ready: firstadmin.Probe{
			Path: "/fallback", Want: []int{http.StatusFound}, Contains: "private readiness",
			Request: func(h *helpers.H) helpers.Request {
				return helpers.Request{Path: "/protected", User: h.AdminUser(), Password: h.AdminPassword(), NoRedirect: true}
			},
		},
		Login: func(context.Context, *helpers.H, string, string) (bool, error) { return true, nil },
	}
	if err := admin.Setup(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || !strings.Contains(results[0].Msg, "/protected") || strings.Contains(results[0].Msg+results[0].Hint, "/fallback") {
		t.Fatalf("readiness reported a different path: %+v", results)
	}
	assertNoSecret(t, adminPassword, nil, results)
}

func TestProbeRequestDefaultsToConfiguredPath(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		resolved bool
	}{{"nil resolver", false}, {"empty resolved path", true}} {
		t.Run(scenario.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/ready" {
					t.Error("probe changed the configured path")
				}
				if (r.Header.Get("Authorization") != "") != scenario.resolved {
					t.Error("probe changed default authentication")
				}
				w.WriteHeader(http.StatusCreated)
				w.Write([]byte("ready"))
			}))
			t.Cleanup(server.Close)
			var results []helpers.StepResult
			h := newH(t, server, &results)
			probe := firstadmin.Probe{Path: "/ready", Want: []int{http.StatusCreated}, Contains: "ready", Timeout: time.Second}
			if scenario.resolved {
				probe.Request = func(h *helpers.H) helpers.Request {
					return helpers.Request{User: h.AdminUser(), Password: h.AdminPassword()}
				}
			}
			if err := (firstadmin.NoAccount{Probe: probe}).Check(t.Context(), h); err != nil {
				t.Fatal(err)
			}
		})
	}
}
