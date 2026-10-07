package kopia_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/kopia"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

const password = "admin-password-123"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != password {
			w.Header().Set("WWW-Authenticate", `Basic realm="Kopia"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: "Kopia-Session-Cookie", Value: "synthetic-session", Path: "/"})
			w.Write([]byte(`<html><head><meta name="kopia-csrf-token" content="` + token + `" /></head></html>`))
			return
		}
		cookie, err := r.Cookie("Kopia-Session-Cookie")
		if err != nil || cookie.Value != "synthetic-session" || r.Header.Get("X-Kopia-Csrf-Token") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"username": "backup", "hostname": "host"})
	})
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "kopia", Service: "kopia",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": password},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})
}

func TestSetupCheckPass(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (kopia.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (kopia.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := kopia.App{}
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = nil
	if err := a.Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range results {
		if r.ID == "ready" {
			continue
		}
		if r.Status != "skip" {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
}

func TestWrongPasswordFailsWithHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := helpers.New(helpers.Config{
		App: "kopia", Service: "kopia",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "not-the-saved-password"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     systemtest.NewDeps(t).Now, Sleep: systemtest.NewDeps(t).Sleep,
	})

	err := (kopia.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-auth step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-auth" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != "fail" {
		t.Fatalf("admin-auth did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}

func TestSetupAndCheckUsePinnedKopiaUISessionWithoutCreatingRepository(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	sessions, verified := 0, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("verification changed repository/account: %s", r.Method)
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != password {
			w.Header().Set("WWW-Authenticate", `Basic realm="Kopia"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/" {
			sessions++
			http.SetCookie(w, &http.Cookie{Name: "Kopia-Session-Cookie", Value: "synthetic-session", Path: "/"})
			w.Write([]byte(`<html><head><meta name="kopia-csrf-token" content="` + token + `" /></head></html>`))
			return
		}
		cookie, err := r.Cookie("Kopia-Session-Cookie")
		if err != nil || cookie.Value != "synthetic-session" || r.Header.Get("X-Kopia-Csrf-Token") != token {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("Invalid or missing CSRF token."))
			return
		}
		if r.URL.Path != "/api/v1/current-user" {
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
		}
		verified++
		json.NewEncoder(w).Encode(map[string]string{"username": "backup", "hostname": "host"})
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	if err := (kopia.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("pinned CSRF-protected API Setup failed: %v", err)
	}
	if err := (kopia.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("pinned CSRF-protected API Check failed: %v", err)
	}
	if sessions < 2 || verified < 2 {
		t.Fatalf("authenticated UI session not verified: sessions=%d verified=%d", sessions, verified)
	}
}

func TestAuthenticationFailuresAreFixedAndDoNotExposeSessionsOrBodies(t *testing.T) {
	for _, tc := range []struct {
		name                    string
		uiStatus, apiStatus     int
		uiBody, apiBody, detail string
		cookie                  bool
	}{
		{name: "saved-login-refused", uiStatus: http.StatusUnauthorized, detail: "Kopia UI returned HTTP 401"},
		{name: "missing-session", uiStatus: http.StatusOK, uiBody: "synthetic-private-response", detail: "session cookie and CSRF token"},
		{name: "missing-token", uiStatus: http.StatusOK, cookie: true, uiBody: "synthetic-private-response", detail: "session cookie and CSRF token"},
		{name: "session-api-refused", uiStatus: http.StatusOK, apiStatus: http.StatusUnauthorized, cookie: true, detail: "current-user API returned HTTP 401"},
		{name: "invalid-identity", uiStatus: http.StatusOK, apiStatus: http.StatusOK, cookie: true, apiBody: "synthetic-private-response", detail: "invalid identity JSON"},
		{name: "empty-identity", uiStatus: http.StatusOK, apiStatus: http.StatusOK, cookie: true, apiBody: `{}`, detail: "omitted its username or hostname"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				user, pass, ok := r.BasicAuth()
				if !ok || user != "admin" || pass != password {
					w.Header().Set("WWW-Authenticate", `Basic realm="Kopia"`)
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if r.URL.Path == "/" {
					if tc.cookie {
						http.SetCookie(w, &http.Cookie{Name: "Kopia-Session-Cookie", Value: "synthetic-private-session", Path: "/"})
					}
					w.WriteHeader(tc.uiStatus)
					body := tc.uiBody
					if body == "" {
						body = `<head><meta name="kopia-csrf-token" content="` + token + `" /></head>`
					}
					w.Write([]byte(body))
					return
				}
				w.WriteHeader(tc.apiStatus)
				w.Write([]byte(tc.apiBody))
			}))
			defer srv.Close()
			var results []helpers.StepResult
			h := newH(t, srv, &results)
			err := (kopia.App{}).Setup(context.Background(), h)
			if err == nil || !strings.Contains(err.Error(), tc.detail) {
				t.Fatalf("want sanitized %s diagnostic, got %v", tc.detail, err)
			}
			text := err.Error()
			for _, r := range results {
				text += r.Error + r.Hint
			}
			for _, secret := range []string{password, "synthetic-private-response", "synthetic-private-session", token} {
				if strings.Contains(text, secret) {
					t.Fatalf("failure exposed synthetic private data (%s)", tc.name)
				}
			}
		})
	}
}

func TestKopiaVerificationKeepsServerCSRFProtectionEnabled(t *testing.T) {
	compose := (kopia.App{}).Compose(app.RenderContext{Port: 51515})
	if strings.Contains(compose, "disable-csrf-token-checks") {
		t.Fatal("verification must not disable server CSRF protection")
	}
}
