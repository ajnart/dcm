package gotify_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/gotify"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

const (
	adminUser     = "admin"
	adminPassword = "Pa55word-long"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "gotify", Service: "gotify", BaseURL: srv.URL, URL: srv.URL,
		HTTP:    srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPassword},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}

// fakeGotify models GET /version and GET /current/user from the v3.1.1 API.
func fakeGotify(acceptPassword string) *httptest.Server {
	mux := http.NewServeMux()
	homarrPassword := ""
	mux.HandleFunc("GET /version", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":"3.1.1"}`))
	})
	mux.HandleFunc("GET /current/user", func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if ok && user == "self-host-homarr" && homarrPassword != "" && password == homarrPassword {
			w.Write([]byte(`{"name":"self-host-homarr","admin":false,"id":2}`))
			return
		}
		if !ok || user != adminUser || password != acceptPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"name":"admin","admin":true,"id":1}`))
	})
	mux.HandleFunc("GET /user", func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != adminUser || password != acceptPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if homarrPassword != "" {
			w.Write([]byte(`[{"name":"admin","admin":true,"id":1},{"name":"self-host-homarr","admin":false,"id":2}]`))
			return
		}
		w.Write([]byte(`[{"name":"admin","admin":true,"id":1}]`))
	})
	mux.HandleFunc("POST /user", func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != adminUser || password != acceptPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var account struct {
			Name  string `json:"name"`
			Pass  string `json:"pass"`
			Admin bool   `json:"admin"`
		}
		if json.NewDecoder(r.Body).Decode(&account) != nil || account.Name != "self-host-homarr" || account.Pass == "" || account.Admin || homarrPassword != "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		homarrPassword = account.Pass
		w.Write([]byte(`{"name":"self-host-homarr","admin":false,"id":2}`))
	})
	mux.HandleFunc("GET /message", func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "self-host-homarr" || homarrPassword == "" || password != homarrPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("limit") != "100" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Write([]byte(`{"paging":{"size":0,"limit":100,"next":"","since":0},"messages":[]}`))
	})
	return httptest.NewServer(mux)
}

func TestSetupThenCheckPass(t *testing.T) {
	srv := fakeGotify(adminPassword)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()

	if err := (gotify.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (gotify.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := fakeGotify(adminPassword)
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (gotify.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}
	results = results[:0]
	if err := (gotify.App{}).Setup(context.Background(), h); err != nil {
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
	srv := fakeGotify("some-other-password")
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	err := (gotify.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failure")
	}
	fail := results[len(results)-1]
	if fail.Status != stepstatus.StepFail || !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint does not name the credentials command: %+v", fail)
	}
}
