package nzbget_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/nzbget"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

const password = "admin-password-123"

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

func handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /jsonrpc", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || !(user == "admin" && pass == password || user == "self-host-homarr" && pass == "restricted-password") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var request struct{ ID, Method string }
		json.NewDecoder(r.Body).Decode(&request)
		var result any
		switch request.Method {
		case "version":
			result = "26.3"
		case "config", "loadconfig":
			if user != "admin" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			result = []map[string]string{
				{"Name": "RestrictedUsername", "Value": "self-host-homarr"},
				{"Name": "RestrictedPassword", "Value": "restricted-password"},
			}
		case "status":
			result = map[string]any{"DownloadPaused": false, "DownloadRate": 0}
		case "listgroups", "history":
			result = []any{}
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": request.ID, "error": nil, "result": result})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "nzbget", Service: "nzbget",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{
			"ADMIN_USER": "admin", "ADMIN_PASSWORD": password,
			"NZBGET_HOMARR_USERNAME": "self-host-homarr", "NZBGET_HOMARR_PASSWORD": "restricted-password",
		},
		Log:    events.Discard(),
		Record: func(r helpers.StepResult) { *results = append(*results, r) },
		Now:    deps.Now, Sleep: deps.Sleep,
	})
}

func TestSetupCheckPass(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)

	if err := (nzbget.App{}).Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (nzbget.App{}).Check(context.Background(), h); err != nil {
		t.Fatalf("Check: %v", err)
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, &results)
	ctx := context.Background()
	a := nzbget.App{}
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
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s status %q, want skip", r.ID, r.Status)
		}
	}
}

func TestWrongPasswordFailsWithHint(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	var results []helpers.StepResult
	deps := systemtest.NewDeps(t)
	h := helpers.New(helpers.Config{
		App: "nzbget", Service: "nzbget",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "wrong"},
		Log:     events.Discard(),
		Record:  func(r helpers.StepResult) { results = append(results, r) },
		Now:     deps.Now, Sleep: deps.Sleep,
	})

	err := (nzbget.App{}).Setup(context.Background(), h)
	if err == nil {
		t.Fatal("Setup = nil, want a failed admin-rpc step")
	}
	var fail *helpers.StepResult
	for i := range results {
		if results[i].ID == "admin-rpc" {
			fail = &results[i]
		}
	}
	if fail == nil || fail.Status != stepstatus.StepFail {
		t.Fatalf("admin-rpc did not fail: %+v", results)
	}
	if !strings.Contains(fail.Hint, "self-host credentials") {
		t.Errorf("hint %q should name the credential", fail.Hint)
	}
}
