package aria2_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/aria2"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
	rpcToken  = "a-valid-generated-rpc-token"
)

const downloads = "/var/lib/aria2/downloads"

func fakeRPC(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Method string   `json:"method"`
		Params []string `json:"params"`
		ID     int      `json:"id"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	token := ""
	if len(req.Params) > 0 {
		token = strings.TrimPrefix(req.Params[0], "token:")
	}
	if token != rpcToken {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID,
			"error": map[string]any{"code": 1, "message": "Unauthorized"}})
		return
	}
	result := map[string]any{}
	switch req.Method {
	case "aria2.getVersion":
		result = map[string]any{"version": "1.37.0"}
	case "aria2.getGlobalOption":
		result = map[string]any{"dir": downloads}
	}
	json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult, token string) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "aria2", Service: "aria2",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass, "ARIA2_RPC_TOKEN": token},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(fakeRPC))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, rpcToken)
	ctx := context.Background()

	if err := (aria2.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (aria2.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (aria2.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheStartCommand(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(fakeRPC))
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records, "the-wrong-token")

	if err := (aria2.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the RPC token does not authenticate")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host start aria2") {
		t.Errorf("hint should name the start command, got %q", hint)
	}
}
