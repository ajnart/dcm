package transmission_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/porttest"
	"github.com/ajnart/self-host/internal/apps/transmission"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
)

type fakeTransmission struct {
	mu              sync.Mutex
	user            string
	password        string
	bruteForceLimit int
	attempts        int
	anonymous       int
	accepted        int
	lockouts        int
}

func (f *fakeTransmission) auth(w http.ResponseWriter, r *http.Request) bool {
	// Transmission 4.1.3 rpc-server.cc checks the lockout before credentials;
	// missing auth consumes an attempt, and accepted auth resets the counter.
	if f.bruteForceLimit > 0 && f.attempts >= f.bruteForceLimit {
		f.lockouts++
		w.WriteHeader(http.StatusForbidden)
		return false
	}
	user, password, ok := r.BasicAuth()
	if !ok || user != f.user || password != f.password {
		if f.bruteForceLimit > 0 {
			f.attempts++
		}
		if !ok {
			f.anonymous++
		}
		w.WriteHeader(http.StatusUnauthorized)
		return false
	}
	f.attempts = 0
	f.accepted++
	return true
}

func (f *fakeTransmission) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /transmission/web/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.auth(w, r) {
			return
		}
		w.Write([]byte("web"))
	})
	mux.HandleFunc("POST /transmission/rpc", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.auth(w, r) {
			return
		}
		if r.Header.Get("X-Transmission-Session-Id") == "" {
			w.Header().Set("X-Transmission-Session-Id", "csrf")
			w.WriteHeader(http.StatusConflict)
			return
		}
		var request struct {
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		switch request.Method {
		case "session-get":
			w.Write([]byte(`{"result":"success","arguments":{"version":"4.1.3","rpc-version-semver":"6.0.1"}}`))
		case "session-stats":
			w.Write([]byte(`{"result":"success","arguments":{"downloadSpeed":0,"uploadSpeed":0,"torrentCount":0,"activeTorrentCount":0,"pausedTorrentCount":0}}`))
		case "torrent-get":
			w.Write([]byte(`{"result":"success","arguments":{"torrents":[]}}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	return mux
}

func TestPreseededLoginIsProvenThroughRPC(t *testing.T) {
	server := httptest.NewServer((&fakeTransmission{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	h.Config.Exec = &authPolicyExec{t: t, output: "true"}
	if err := (transmission.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (transmission.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("admin step = %q, want skip", rec.Status("admin"))
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	server := httptest.NewServer((&fakeTransmission{user: "admin", password: "secret"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	h.Config.Exec = &authPolicyExec{t: t, output: "true"}
	if err := (transmission.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if rec.Status("ready") != stepstatus.StepSkip || rec.Status("admin") != stepstatus.StepSkip {
		t.Fatalf("rerun should skip: ready=%q admin=%q", rec.Status("ready"), rec.Status("admin"))
	}
}

func TestTheHintNamesTheAppWhenTheSeedDidNotApply(t *testing.T) {
	server := httptest.NewServer((&fakeTransmission{user: "admin", password: "changed"}).handler())
	defer server.Close()
	rec := &porttest.Recorder{}
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
		Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)

	h.Config.Exec = &authPolicyExec{t: t, output: "true"}
	if err := (transmission.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the seeded login is refused")
	}
	if rec.Status("admin") != stepstatus.StepManual || !strings.Contains(rec.Hint(), server.URL) {
		t.Fatalf("admin step should be manual with the App URL hint, got %q", rec.Hint())
	}
}

func TestSetupAndCheckDoNotLockOutValidRPCLogin(t *testing.T) {
	for _, limit := range []int{1, 2} {
		t.Run(strconv.Itoa(limit), func(t *testing.T) {
			fake := &fakeTransmission{user: "admin", password: "secret", bruteForceLimit: limit}
			server := httptest.NewServer(fake.handler())
			t.Cleanup(server.Close)
			rec := &porttest.Recorder{}
			h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
				Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, rec)
			h.Config.Exec = &authPolicyExec{t: t, output: "true"}
			for run := 0; run < 2; run++ {
				if err := (transmission.App{}).Setup(t.Context(), h); err != nil {
					t.Fatalf("Setup locked out the valid RPC login at the configured threshold: %v (attempts=%d lockouts=%d accepted=%d)", err, fake.attempts, fake.lockouts, fake.accepted)
				}
				if err := (transmission.App{}).Check(t.Context(), h); err != nil {
					t.Fatalf("Check locked out the valid RPC login at the configured threshold: %v", err)
				}
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if fake.bruteForceLimit != limit || fake.lockouts != 0 || fake.attempts != 0 || fake.accepted == 0 || fake.anonymous != 0 {
				t.Fatalf("protection changed or auth was not reset: limit=%d lockouts=%d attempts=%d accepted=%d anonymous=%d", fake.bruteForceLimit, fake.lockouts, fake.attempts, fake.accepted, fake.anonymous)
			}
		})
	}
}

type authPolicyExec struct {
	t        *testing.T
	output   string
	exitCode int
	err      error
}

func (f *authPolicyExec) Exec(_ context.Context, service string, env map[string]string, command ...string) (system.Result, error) {
	f.t.Helper()
	if service != "transmission" || len(env) != 0 || len(command) != 3 || command[0] != "sh" || command[1] != "-c" || !strings.Contains(command[2], "rpc-authentication-required") || !strings.Contains(command[2], "/config/settings.json 2>/dev/null") {
		f.t.Fatal("policy probe escaped its narrow App-owned boolean read")
	}
	return system.Result{Stdout: []byte(f.output), ExitCode: f.exitCode}, f.err
}
func (*authPolicyExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (*authPolicyExec) Restart(context.Context, ...string) error                { return nil }
func (*authPolicyExec) Up(context.Context, ...string) error                     { return nil }

func TestCheckRequiresSavedRPCAuthenticationPolicy(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		output     string
		exitCode   int
		err        error
		noExecutor bool
	}{
		{name: "disabled policy", output: "false"},
		{name: "missing policy", output: "null"},
		{name: "ambiguous output", output: "private-fixture-marker"},
		{name: "failed probe", output: "true", exitCode: 1},
		{name: "executor failure", err: errors.New("private-fixture-marker")},
		{name: "unavailable probe", noExecutor: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Error("unverified policy caused an HTTP authentication attempt")
				w.WriteHeader(http.StatusForbidden)
			}))
			t.Cleanup(server.Close)
			h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission",
				Secrets: porttest.Secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "secret"}}, server, &porttest.Recorder{})
			if !scenario.noExecutor {
				h.Config.Exec = &authPolicyExec{t: t, output: scenario.output, exitCode: scenario.exitCode, err: scenario.err}
			}
			err := (transmission.App{}).Check(t.Context(), h)
			if !errors.Is(err, helpers.ErrManual) || !strings.Contains(err.Error(), "saved RPC authentication policy") || !strings.Contains(err.Error(), "restart Transmission") || strings.Contains(err.Error(), "private-fixture-marker") {
				t.Fatalf("unverified policy did not give private Manual recovery: %v", err)
			}
		})
	}
}

func TestSetupMissingAdminDoesNotProbeAnonymously(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("missing Admin login caused an anonymous probe")
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)
	h := porttest.New(t, porttest.Options{App: "transmission", Service: "transmission", Secrets: porttest.Secrets{}}, server, &porttest.Recorder{})
	if err := (transmission.App{}).Setup(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("missing Admin login did not remain Manual: %v", err)
	}
}
