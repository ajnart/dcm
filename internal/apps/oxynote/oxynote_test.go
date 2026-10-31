package oxynote_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/oxynote"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

// fake is the image's auth service: one admin and a trusted origin.
type fake struct {
	password, origin string
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	switch r.Method + " " + r.URL.Path {
	case "GET /auth-realtime/api/auth-config":
		w.WriteHeader(http.StatusOK)
	case "POST /auth-realtime/api/auth/sign-in/email":
		if body["email"] != "admin@example.com" || body["password"] != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "auth.session_token", Value: "fixture-session"})
	case "POST /auth-realtime/api/auth/change-password":
		if c, err := r.Cookie("auth.session_token"); err != nil || c.Value != "fixture-session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Origin") != f.origin {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if body["currentPassword"] != f.password {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.password = body["newPassword"].(string)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func newH(srv *httptest.Server, password string, records *[]helpers.StepResult) *helpers.H {
	return helpers.New(helpers.Config{App: "oxynote", BaseURL: srv.URL, URL: srv.URL, Port: 8085,
		Settings: map[string]string{"LAN_IP": "192.168.1.20"}, HTTP: srv.Client(), Log: events.Discard(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": password},
		Record:  func(r helpers.StepResult) { *records = append(*records, r) }})
}

func TestSetupReplacesTheDefaultPasswordOnce(t *testing.T) {
	f := &fake{password: "oxynote-admin-1234", origin: "http://192.168.1.20:8085"}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(srv, "fixture-only-password-20", &records)

	if err := (oxynote.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup = %v", err)
	}
	if f.password != "fixture-only-password-20" {
		t.Fatalf("password = %q, want the Admin password", f.password)
	}
	records = nil
	if err := (oxynote.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup = %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Fatalf("second Setup records = %+v, want all skipped", records)
		}
	}
	if err := (oxynote.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check = %v", err)
	}
}

func TestSetupKeepsTheDefaultPasswordWhenTheAdminPasswordIsTooShort(t *testing.T) {
	f := &fake{password: "oxynote-admin-1234", origin: "http://192.168.1.20:8085"}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	var records []helpers.StepResult

	err := (oxynote.App{}).Setup(context.Background(), newH(srv, "short-password", &records))
	if err == nil || !strings.Contains(err.Error(), "16 to 128 characters") {
		t.Fatalf("Setup = %v, want the length rule", err)
	}
	if f.password != "oxynote-admin-1234" {
		t.Fatalf("password = %q, want the default kept", f.password)
	}
}

func TestComposePublicURLIsTheAddressPeopleOpen(t *testing.T) {
	cases := map[string]struct {
		settings map[string]string
		want     string
	}{
		"home network":  {map[string]string{"LAN_IP": "192.168.1.20"}, "http://${LAN_IP}:8085"},
		"this computer": {map[string]string{"LAN_IP": "192.168.1.20", "EXPOSURE": "local"}, "http://127.0.0.1:8085"},
		"easy names":    {map[string]string{"LAN_IP": "192.168.1.20", "EASY_NAMES": "on"}, "http://oxynote.192-168-1-20.sslip.io"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			compose := (oxynote.App{}).Compose(app.RenderContext{Port: 8085, Settings: c.settings})
			if !strings.Contains(compose, "OXYNOTE_PUBLIC_URL: "+c.want+"\n") {
				t.Fatalf("compose lacks OXYNOTE_PUBLIC_URL %s:\n%s", c.want, compose)
			}
		})
	}
}
