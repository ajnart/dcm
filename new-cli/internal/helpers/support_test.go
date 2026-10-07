package helpers_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type secrets map[string]string

func (s secrets) Get(key string) string       { return s[key] }
func (s secrets) Set(key, value string) error { s[key] = value; return nil }

type execCall struct {
	service string
	env     map[string]string
	command []string
}

type fakeExec struct {
	mu    sync.Mutex
	calls []execCall
}

func (f *fakeExec) Exec(_ context.Context, service string, env map[string]string, command ...string) (system.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, execCall{service: service, env: env, command: append([]string(nil), command...)})
	return system.Result{}, nil
}

func (*fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (*fakeExec) Restart(context.Context, ...string) error                { return nil }

func newH(t *testing.T, srv *httptest.Server, exec helpers.Executor, results *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	if exec == nil {
		exec = &fakeExec{}
	}
	if results == nil {
		results = &[]helpers.StepResult{}
	}
	base := ""
	var client *http.Client
	if srv != nil {
		base, client = srv.URL, srv.Client()
	}
	return helpers.New(helpers.Config{
		App:     "demo",
		Service: "demo",
		BaseURL: base,
		URL:     base,
		HTTP:    client,
		Secrets: secrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"},
		Log:     events.Discard(),
		Exec:    exec,
		Record:  func(r helpers.StepResult) { *results = append(*results, r) },
		Now:     deps.Now,
		Sleep:   deps.Sleep,
	})
}
