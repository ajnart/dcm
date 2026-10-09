package lldap_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/lldap"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

const (
	adminUser     = "admin"
	adminPassword = "Pa55word-long"
	token         = "tok-abcdefghijklmnop"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "lldap", Service: "lldap", BaseURL: srv.URL, URL: srv.URL,
		HTTP:    srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPassword},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

// fakeLLDAP models the login API and the administrator read-back query.
func fakeLLDAP(acceptPassword string) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html>lldap</html>"))
	})
	mux.HandleFunc("POST /auth/simple/login", func(w http.ResponseWriter, r *http.Request) {
		var credentials struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&credentials)
		if credentials.Username != adminUser || credentials.Password != acceptPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"token":"` + token + `"}`))
	})
	mux.HandleFunc("POST /api/graphql", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"data":{"user":{"id":"admin","groups":[{"displayName":"lldap_admin"}]}}}`))
	})
	return httptest.NewServer(mux)
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := fakeLLDAP(adminPassword)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()

	if err := (lldap.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (lldap.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := fakeLLDAP(adminPassword)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (lldap.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (lldap.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("no steps recorded on the rerun")
	}
	for i, r := range results {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %d (%s) = %q, want skip", i, r.ID, r.Status)
		}
	}
}

func TestARejectedAdminLoginNamesTheCredentialCommand(t *testing.T) {
	srv := fakeLLDAP("some-other-password")
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	err := (lldap.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	fail := results[len(results)-1]
	if fail.Status != stepstatus.StepFail || !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint does not name the credentials command: %+v", fail)
	}
}
