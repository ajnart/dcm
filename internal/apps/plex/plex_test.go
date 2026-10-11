package plex_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/apps/plex"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser   = "admin"
	adminPass   = "correct-horse-battery"
	serverToken = "server-token-abcdefgh"
	machineID   = "machine-identifier-abcdefgh"
)

type fakePlex struct {
	mu      sync.Mutex
	claimed bool
}

func (f *fakePlex) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /identity", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{
			"machineIdentifier": machineID, "claimed": f.claimed}})
	})
	mux.HandleFunc("GET /library/sections", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Plex-Token") != serverToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"size": 0}})
	})
	for _, path := range []string{"/prefs", "/status/sessions", "/library/recentlyAdded"} {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Plex-Token") != serverToken {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"MediaContainer": map[string]any{"size": 0}})
		})
	}
	return mux
}

// execFake answers the read-only xmlstarlet selector Plex Setup runs.
type execFake struct {
	mu sync.Mutex
}

func (e *execFake) Exec(_ context.Context, _ string, _ map[string]string, command ...string) (system.Result, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if strings.Contains(strings.Join(command, " "), "xmlstarlet") {
		return system.Result{Stdout: []byte(serverToken + "\n" + machineID + "\n")}, nil
	}
	return system.Result{}, nil
}

func (e *execFake) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (e *execFake) Restart(context.Context, ...string) error                { return nil }
func (e *execFake) Up(context.Context, ...string) error                     { return nil }

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, inputs map[string]string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	exec := &execFake{}
	return helpers.New(helpers.Config{
		App: "plex", Service: "plex",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Inputs:  inputs,
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Exec:    exec,
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		PollInterval: time.Millisecond,
		Record:       func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakePlex{claimed: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{"claim_token": "owner-claim-token", "verified_server_id": machineID})
	ctx := context.Background()

	if err := (plex.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (plex.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (plex.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestMissingClaimTokenHintNamesTheClaimPage(t *testing.T) {
	srv := httptest.NewServer((&fakePlex{}).handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, map[string]string{})

	if err := (plex.App{}).Setup(context.Background(), h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("Setup should remain Manual when no claim token was supplied")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepManual {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "plex.tv/claim") {
		t.Errorf("hint should name where to get the claim token, got %q", hint)
	}
}
