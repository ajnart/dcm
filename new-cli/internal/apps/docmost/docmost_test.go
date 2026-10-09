package docmost_test

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

	"github.com/ajnart/self-host/internal/apps/docmost"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type fakeDocmost struct {
	mu               sync.Mutex
	email            string
	pass             string
	owner            bool
	setups           int
	limited          int
	retryAfter       string
	loginAttempts    int
	identityReads    int
	loginFailureBody string
}

// jsonOnly mirrors Docmost's Fastify, which answers 415 when a POST carries a
// body that has no application/json media type.
func jsonOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength != 0 && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			w.WriteHeader(http.StatusUnsupportedMediaType)
			return
		}
		next(w, r)
	}
}

func (f *fakeDocmost) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("POST /api/auth/setup", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.setups++
		var body struct{ Name, Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Email != f.email || body.Password != f.pass {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.owner = true
		http.SetCookie(w, &http.Cookie{Name: "authToken", Value: "cookie"})
		json.NewEncoder(w).Encode(map[string]any{"success": true, "status": 200, "data": map[string]string{"id": "w1"}})
	}))
	mux.HandleFunc("POST /api/auth/login", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.loginAttempts++
		if f.limited != 0 {
			if f.limited > 0 {
				f.limited--
			}
			if f.retryAfter != "" {
				w.Header().Set("Retry-After-auth", f.retryAfter)
			}
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		var body struct{ Email, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		// Pinned v0.96.0's workspace preHandler rejects login before the
		// first workspace exists; setup is explicitly exempt from that guard.
		if !f.owner || f.loginFailureBody != "" {
			w.WriteHeader(http.StatusNotFound)
			if f.loginFailureBody != "" {
				w.Write([]byte(f.loginFailureBody))
			} else {
				json.NewEncoder(w).Encode(map[string]any{"statusCode": 404, "message": "Workspace not found", "error": "Not Found"})
			}
			return
		}
		if body.Email != f.email || body.Password != f.pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "authToken", Value: "cookie"})
		json.NewEncoder(w).Encode(map[string]any{"success": true, "status": 200})
	}))
	mux.HandleFunc("POST /api/users/me", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.identityReads++
		if c, err := r.Cookie("authToken"); err != nil || c.Value != "cookie" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"success": true, "status": 200,
			"data": map[string]any{"user": map[string]string{"email": f.email, "role": "owner"}},
		})
	}))
	return mux
}

type harness struct {
	h       *helpers.H
	results []helpers.StepResult
}

func newHarness(t *testing.T, fake *fakeDocmost, sec secrets) *harness {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	deps := systemtest.NewDeps(t)
	box := &harness{}
	box.h = helpers.New(helpers.Config{
		App: "docmost", Service: "docmost",
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

func TestSetupCreatesTheFirstOwnerThenCheck(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw"}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := docmost.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := app.Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if fake.setups != 1 {
		t.Fatalf("setups = %d, want 1", fake.setups)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw"}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	app := docmost.App{}
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	box.results = nil
	if err := app.Setup(context.Background(), box.h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, id := range []string{"admin"} {
		if got := box.step(id); got.Status != stepstatus.StepSkip {
			t.Errorf("step %s on rerun = %q, want skip", id, got.Status)
		}
	}
	if fake.setups != 1 {
		t.Errorf("setups = %d, want 1", fake.setups)
	}
}

func TestWrongPasswordHintNamesThePage(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "right", owner: true}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong"})
	err := docmost.App{}.Setup(context.Background(), box.h)
	if err == nil {
		t.Fatal("Setup should fail with the wrong password")
	}
	if !strings.Contains(box.step("admin").Hint, box.h.URL) {
		t.Errorf("hint should name the App page, got %q", box.step("admin").Hint)
	}
}

func TestCheckWaitsForNamedAuthRateLimitThenVerifiesOwner(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw", owner: true, limited: 1, retryAfter: "60"}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	start := box.h.Now()
	if err := (docmost.App{}).Check(context.Background(), box.h); err != nil {
		t.Fatalf("Check after the auth rate limit expires: %v", err)
	}
	if got := box.h.Now().Sub(start); got != time.Minute {
		t.Fatalf("waited %s, want the named auth Retry-After of one minute", got)
	}
	if fake.loginAttempts != 2 || fake.setups != 0 {
		t.Fatalf("login attempts = %d, setup writes = %d", fake.loginAttempts, fake.setups)
	}
}

func TestSetupPersistentRateLimitIsBoundedAndDoesNotCreateOwner(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw", owner: true, limited: -1}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	start := box.h.Now()
	err := (docmost.App{}).Setup(context.Background(), box.h)
	if err == nil || !strings.Contains(err.Error(), "HTTP 429") || !strings.Contains(err.Error(), "self-host setup docmost") {
		t.Fatalf("missing bounded rate-limit recovery diagnostic: %v", err)
	}
	if box.h.Now().Sub(start) != 2*time.Minute || fake.loginAttempts != 3 {
		t.Fatalf("wait = %s, login attempts = %d", box.h.Now().Sub(start), fake.loginAttempts)
	}
	if fake.setups != 0 || fake.pass != "pw" || !fake.owner {
		t.Fatalf("existing owner was touched: setup writes = %d", fake.setups)
	}
}

func TestRateLimitWaitCancellationStopsAuthenticationAndSetup(t *testing.T) {
	for _, operation := range []struct {
		name string
		run  func(context.Context, *helpers.H) error
	}{
		{name: "Check", run: (docmost.App{}).Check},
		{name: "Setup", run: (docmost.App{}).Setup},
	} {
		t.Run(operation.name, func(t *testing.T) {
			fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw", owner: true, limited: 1, retryAfter: "2"}
			srv := httptest.NewServer(fake.handler())
			defer srv.Close()
			h := helpers.New(helpers.Config{
				App: "docmost", Service: "docmost", BaseURL: srv.URL, URL: srv.URL,
				HTTP: srv.Client(), Log: events.Discard(),
				Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"},
			})
			// Keep the real helper wait; signal its entry so cancellation happens
			// after the rate-limit response, rather than before the first request.
			waitStarted := make(chan time.Duration, 1)
			sleep := h.Sleep
			h.Sleep = func(ctx context.Context, duration time.Duration) error {
				waitStarted <- duration
				return sleep(ctx, duration)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- operation.run(ctx, h) }()
			select {
			case duration := <-waitStarted:
				if duration != 2*time.Second {
					t.Fatalf("retry wait = %s, want 2s", duration)
				}
			case <-time.After(time.Second):
				t.Fatal("authentication did not enter the retry wait")
			}
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("canceled %s returned %v, want context.Canceled", operation.name, err)
				}
			case <-time.After(time.Second):
				t.Fatalf("canceled %s did not promptly interrupt the retry wait", operation.name)
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if fake.loginAttempts != 1 || fake.identityReads != 0 || fake.setups != 0 || !fake.owner || fake.pass != "pw" {
				t.Fatalf("cancellation continued authentication or changed the owner: logins=%d, identity reads=%d, setup writes=%d", fake.loginAttempts, fake.identityReads, fake.setups)
			}
		})
	}
}

func TestRateLimitRecoveryStillRejectsWrongCredentials(t *testing.T) {
	fake := &fakeDocmost{email: "admin@selfhost.local", pass: "right", owner: true, limited: 1, retryAfter: "5"}
	box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong"})
	start := box.h.Now()
	err := (docmost.App{}).Check(context.Background(), box.h)
	if err == nil || !strings.Contains(err.Error(), "cannot sign in") {
		t.Fatalf("wrong credentials should still fail after the rate limit, got %v", err)
	}
	if fake.loginAttempts != 2 || box.h.Now().Sub(start) != 5*time.Second || fake.setups != 0 {
		t.Fatalf("unexpected retries or setup writes: login attempts = %d, setup writes = %d", fake.loginAttempts, fake.setups)
	}
}

func TestSetupRejectsUnrecognizedLoginNotFoundWithoutCreatingWorkspace(t *testing.T) {
	for _, body := range []string{`{"statusCode":404,"message":"Cannot POST /api/auth/login","error":"Not Found"}`, `{"statusCode":400,"message":"Workspace not found"}`, `{"message":"Workspace not found"}`, `invalid`} {
		t.Run(body, func(t *testing.T) {
			fake := &fakeDocmost{email: "admin@selfhost.local", pass: "pw", owner: true, loginFailureBody: body}
			box := newHarness(t, fake, secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
			err := (docmost.App{}).Setup(context.Background(), box.h)
			if err == nil || !strings.Contains(err.Error(), "HTTP 404") || fake.setups != 0 || fake.loginAttempts != 1 {
				t.Fatalf("unrecognized 404 attempted workspace mutation or retry: %v, setups=%d, attempts=%d", err, fake.setups, fake.loginAttempts)
			}
		})
	}
}
