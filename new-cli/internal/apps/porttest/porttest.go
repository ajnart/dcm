// Package porttest holds the small harness the ported onboarding Apps use in
// tests: a secret map, a step recorder and H construction.
package porttest

import (
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/systemtest"
)

type Secrets map[string]string

func (s Secrets) Get(key string) string       { return s[key] }
func (s Secrets) Set(key, value string) error { s[key] = value; return nil }

type Recorder struct{ Steps []helpers.StepResult }

func (r *Recorder) Record(step helpers.StepResult) { r.Steps = append(r.Steps, step) }

func (r *Recorder) Step(id string) *helpers.StepResult {
	for i := range r.Steps {
		if r.Steps[i].ID == id {
			return &r.Steps[i]
		}
	}
	return nil
}

func (r *Recorder) Status(id string) string {
	if step := r.Step(id); step != nil {
		return step.Status
	}
	return ""
}

// Hint returns the hint of the first failed step.
func (r *Recorder) Hint() string {
	for _, step := range r.Steps {
		if step.Status == "fail" {
			return step.Hint
		}
	}
	return ""
}

type Options struct {
	App     string
	Service string
	Dir     string
	Secrets Secrets
}

// New builds an H bound to a test server with a fake clock.
func New(t *testing.T, opts Options, server *httptest.Server, rec *Recorder) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: opts.App, Service: opts.Service, Dir: opts.Dir,
		BaseURL: server.URL, URL: server.URL, HTTP: server.Client(),
		Secrets: opts.Secrets, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: rec.Record,
	})
}
