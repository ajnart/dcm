// Package clitest runs the binary in-process against fake Deps, for App tests.
package clitest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/cli"
	"github.com/ajnart/self-host/internal/system"
)

type Result struct {
	Code   int
	Out    string
	Events []map[string]any
}

// Step returns the last terminal event (ok/skip/warn/fail) of app's step.
func (r Result) Step(app, step string) map[string]any {
	var found map[string]any
	for _, e := range r.Events {
		if e["app"] == app && e["step"] == step && e["event"] != "step.start" {
			found = e
		}
	}
	return found
}

// StepEvent returns the event name of a step ("step.ok", …) or "".
func (r Result) StepEvent(app, step string) string {
	if e := r.Step(app, step); e != nil {
		return e["event"].(string)
	}
	return ""
}

func Run(t *testing.T, deps *system.Deps, cat *catalog.Catalog, args ...string) Result {
	t.Helper()
	var out bytes.Buffer
	deps.Out, deps.Err = &out, &out
	code := cli.RunWith(context.Background(), deps, cat, args)
	r := Result{Code: code, Out: out.String()}
	for _, line := range strings.Split(out.String(), "\n") {
		var event map[string]any
		if json.Unmarshal([]byte(line), &event) == nil && event["event"] != nil {
			r.Events = append(r.Events, event)
		}
	}
	return r
}

// Root is the Project directory of the fake user.
func Root(t *testing.T, deps *system.Deps) string {
	t.Helper()
	u, err := deps.CurrentUser()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(u.Home, "self-host")
}

func Read(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

// Port returns the port of a test server, for --set app.port=PORT.
func Port(server *httptest.Server) string {
	u, _ := url.Parse(server.URL)
	return u.Port()
}

// Env returns a Cmd's environment as a map.
func Env(cmd system.Cmd) map[string]string {
	env := map[string]string{}
	for _, kv := range cmd.Env {
		key, value, _ := strings.Cut(kv, "=")
		env[key] = value
	}
	return env
}
