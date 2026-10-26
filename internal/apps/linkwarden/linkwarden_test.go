package linkwarden_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/linkwarden"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets struct {
	values  map[string]string
	durable map[string]string
	failKey string
	failAt  int
}

func (s *secrets) Get(key string) string { return s.values[key] }
func (s *secrets) Set(key, value string) error {
	s.values[key] = value
	if key == s.failKey {
		s.failAt--
		if s.failAt == 0 {
			return errors.New("fixture secret persistence failure")
		}
	}
	s.durable = maps.Clone(s.values)
	return nil
}

type fakeLinkwarden struct {
	mu      sync.Mutex
	user    string
	pass    string
	created bool
	signups int
	token   bool
	issued  int
}

func (f *fakeLinkwarden) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/users", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.signups++
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != f.user || body.Password != f.pass {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.created = true
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{"id": 1, "username": f.user}})
	})
	mux.HandleFunc("POST /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if !f.created || body.Username != f.user || body.Password != f.pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]string{"token": "tok"}})
	})
	mux.HandleFunc("GET /api/v1/users/me", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") == "Bearer foreign-token" {
			json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{"id": 7, "username": "another-user"}})
			return
		}
		if r.Header.Get("Authorization") != "Bearer tok" && (!f.token || r.Header.Get("Authorization") != fmt.Sprintf("Bearer homarr-token-%d", f.issued)) {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"response":"You must be logged in."}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{"id": 1, "username": f.user}})
	})
	mux.HandleFunc("GET /api/v1/tokens", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer tok" && (!f.token || r.Header.Get("Authorization") != fmt.Sprintf("Bearer homarr-token-%d", f.issued)) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		tokens := []map[string]any{}
		if f.token {
			tokens = append(tokens, map[string]any{"id": f.issued + 1, "name": "self-host Homarr statistics", "isSession": false, "expires": "2026-12-31T12:00:00.000Z"})
		}
		json.NewEncoder(w).Encode(map[string]any{"response": tokens})
	})
	mux.HandleFunc("POST /api/v1/tokens", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Name    string `json:"name"`
			Expires int    `json:"expires"`
		}
		if r.Header.Get("Authorization") != "Bearer tok" || json.NewDecoder(r.Body).Decode(&body) != nil || body.Name != "self-host Homarr statistics" || body.Expires != 3 || f.token {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.token = true
		f.issued++
		json.NewEncoder(w).Encode(map[string]any{"response": map[string]any{
			"secretKey": fmt.Sprintf("homarr-token-%d", f.issued),
			"token":     map[string]any{"id": f.issued + 1, "userId": 1, "name": body.Name, "isSession": false, "revoked": false, "expires": "2026-12-31T12:00:00.000Z"},
		}})
	})
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, handler http.Handler, sec *secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	if sec.durable == nil {
		sec.durable = maps.Clone(sec.values)
	}
	box.h = helpers.New(helpers.Config{
		Peer: func(string) *helpers.H { return &helpers.H{} },
		App:  "linkwarden", Service: "linkwarden",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: sec, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { box.results = append(box.results, r) },
	})
	return box
}

func (b *harness) step(id string) helpers.StepResult {
	for i := len(b.results) - 1; i >= 0; i-- {
		if b.results[i].ID == id {
			return b.results[i]
		}
	}
	return helpers.StepResult{}
}

func TestSetupCreatesTheFirstAdminThenCheck(t *testing.T) {
	fake := &fakeLinkwarden{user: "admin", pass: "pw"}
	box := newHarness(t, fake.handler(), &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}})
	app := linkwarden.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if fake.signups != 1 {
		t.Fatalf("signups = %d, want 1", fake.signups)
	}
	if fake.issued != 1 || box.h.Secret(box.h.Key("homarr_api_key")) == "" || box.h.Secret(box.h.Key("homarr_token_ownership")) == "" {
		t.Fatal("Setup did not record one owned Homarr token")
	}
	if id, err := linkwarden.HomarrAccountID(box.h); err != nil || id != 1 {
		t.Fatal("Setup did not record the selected canonical account ID")
	}
	for _, input := range app.Inputs() {
		if !input.Private || input.Required || !strings.Contains(input.Help, "Empty") {
			t.Fatal("Homarr recovery inputs must be optional, private, and preserve empty values")
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeLinkwarden{user: "admin", pass: "pw"}
	sec := &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}}
	box := newHarness(t, fake.handler(), sec)
	app := linkwarden.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"ready", "admin", "homarr-token"} {
		if got := box.step(id); got.Status != stepstatus.StepSkip {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
	if fake.signups != 1 {
		t.Errorf("signups = %d, want 1", fake.signups)
	}
	if fake.issued != 1 {
		t.Errorf("token creations = %d, want 1", fake.issued)
	}
	fake.mu.Lock()
	fake.token = false
	fake.mu.Unlock()
	sec.failKey, sec.failAt = box.h.Key("homarr_api_key"), 2
	if err := app.Setup(context.Background(), box.h); err == nil {
		t.Fatal("failed plaintext persistence passed Setup")
	}
	sec.values = maps.Clone(sec.durable)
	if err := linkwarden.VerifyHomarr(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("a partially saved issued token passed fresh prerequisite verification")
	}
	if err := app.Setup(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) || fake.issued != 2 {
		t.Fatal("pending issuance did not stop as Manual without issuing another token")
	}
	if !strings.Contains(box.step("homarr-token").Hint, "install --set-file") || !strings.Contains(box.step("homarr-token").Hint, "separately approve replacement") {
		t.Fatal("recovery hint lacks the approved private-input and Compose replacement boundaries")
	}
	sec.failKey = ""
	if err := sec.Set(box.h.Key("homarr_api_key"), "homarr-token-2"); err != nil {
		t.Fatal(err)
	}
	if err := app.Setup(context.Background(), box.h); err != nil || fake.issued != 2 {
		t.Fatal("restoring the known pending credential did not reuse its recorded token")
	}
	fake.mu.Lock()
	fake.token = false
	fake.mu.Unlock()
	sec.failKey, sec.failAt = box.h.Key("homarr_token_ownership"), 3
	if err := app.Setup(context.Background(), box.h); err == nil {
		t.Fatal("failed ownership finalization passed Setup")
	}
	sec.values = maps.Clone(sec.durable)
	if err := linkwarden.VerifyHomarr(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("pending ownership finalization passed prerequisite verification")
	}
	sec.failKey = ""
	if err := app.Setup(context.Background(), box.h); err != nil || fake.issued != 3 {
		t.Fatal("a persisted pending pair was not finalized without reissuance")
	}
	if err := sec.Set(box.h.Key("homarr_api_key"), "homarr-token-2"); err != nil {
		t.Fatal(err)
	}
	if err := app.Setup(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) || fake.issued != 3 {
		t.Fatal("an old token with a new fingerprint did not remain Manual while the issued token existed")
	}
	fake.mu.Lock()
	fake.token = false
	fake.mu.Unlock()
	if err := app.Setup(context.Background(), box.h); err != nil || fake.issued != 4 {
		t.Fatal("authenticated absence after explicit revocation did not recover a mismatched pair")
	}
}

func TestUnreadyHintNamesTheLogCommand(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/users/me", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	box := newHarness(t, mux, &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}})
	err := linkwarden.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail while the App is unreachable")
	}
	if !strings.Contains(box.step("ready").Hint, "self-host logs linkwarden") {
		t.Errorf("hint should name the command, got %q", box.step("ready").Hint)
	}
}

// v2.16.3 has no health route: readiness must reach its protected current-user
// route, and success must still verify the saved administrator through a token.
func TestSetupUsesProtectedAPIRouteAndPreservesExistingAdministrator(t *testing.T) {
	fake := &fakeLinkwarden{user: "admin", pass: "pw", created: true}
	box := newHarness(t, fake.handler(), &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}})
	a := linkwarden.App{}
	if err := a.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup with pinned API routes: %v", err)
	}
	if err := a.Check(context.Background(), box.h); err != nil {
		t.Fatalf("authenticated Check: %v", err)
	}
	if fake.signups != 0 {
		t.Fatalf("existing administrator was recreated: %d signups", fake.signups)
	}
	box = newHarness(t, fake.handler(), &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}})
	if err := a.Setup(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) || fake.issued != 1 || fake.signups != 0 {
		t.Fatal("a managed-name collision without recorded ownership was adopted or reissued")
	}
}

func TestReadyRejectsUnrelatedHTTPResponsesBeforeSignup(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"missing-route", http.StatusNotFound, `{"response":"You must be logged in."}`},
		{"anonymous-success", http.StatusOK, `{"response":"You must be logged in."}`},
		{"unrelated-auth-gate", http.StatusUnauthorized, `{"response":"proxy authentication required"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeLinkwarden{user: "admin", pass: "pw"}
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet && r.URL.Path == "/api/v1/users/me" {
					w.WriteHeader(tc.status)
					w.Write([]byte(tc.body))
					return
				}
				fake.handler().ServeHTTP(w, r)
			})
			box := newHarness(t, handler, &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}})
			if err := (linkwarden.App{}).Setup(context.Background(), box.h); err == nil {
				t.Fatal("unrelated response passed readiness")
			}
			if fake.signups != 0 {
				t.Fatalf("signup happened before API readiness: %d", fake.signups)
			}
		})
	}
}

func TestCheckRejectsAuthenticatedWrongIdentity(t *testing.T) {
	fake := &fakeLinkwarden{user: "admin", pass: "pw", created: true}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/users/me" && r.Header.Get("Authorization") == "Bearer tok" {
			w.Write([]byte(`{"response":{"id":1,"username":"another-user"}}`))
			return
		}
		fake.handler().ServeHTTP(w, r)
	})
	box := newHarness(t, handler, &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}})
	if err := (linkwarden.App{}).Check(context.Background(), box.h); err == nil {
		t.Fatal("wrong authenticated identity passed Check")
	}
	sec := &secrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"}}
	box = newHarness(t, fake.handler(), sec)
	if err := (linkwarden.App{}).Setup(context.Background(), box.h); err != nil {
		t.Fatal(err)
	}
	var ownership map[string]any
	if err := json.Unmarshal([]byte(sec.Get(box.h.Key("homarr_token_ownership"))), &ownership); err != nil {
		t.Fatal(err)
	}
	fingerprint := sha256.Sum256([]byte("foreign-token"))
	ownership["fingerprint"] = hex.EncodeToString(fingerprint[:])
	metadata, err := json.Marshal(ownership)
	if err != nil {
		t.Fatal(err)
	}
	if err := sec.Set(box.h.Key("homarr_token_ownership"), string(metadata)); err != nil {
		t.Fatal(err)
	}
	if err := sec.Set(box.h.Key("homarr_api_key"), "foreign-token"); err != nil {
		t.Fatal(err)
	}
	before := maps.Clone(sec.values)
	if err := linkwarden.VerifyHomarr(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) || !maps.Equal(before, sec.values) || fake.issued != 1 {
		t.Fatal("a freshly probed foreign-account token was accepted or mutated the saved prerequisites")
	}
	if err := (linkwarden.App{}).Setup(context.Background(), box.h); !errors.Is(err, helpers.ErrManual) || !maps.Equal(before, sec.values) || fake.issued != 1 {
		t.Fatal("a foreign-account token was silently adopted during Setup recovery")
	}
}
