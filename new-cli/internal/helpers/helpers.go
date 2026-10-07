// Package helpers is the toolkit every App's Setup uses: idempotent steps,
// HTTP, container exec, secrets and config edits. Logging and redaction
// happen here so Apps never print on their own.
package helpers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
)

// ErrStepFailed marks an error already reported as step.fail.
var ErrStepFailed = errors.New("setup step failed")

type Secrets interface {
	Get(key string) string
	Set(key, value string) error
}

type Executor interface {
	Exec(ctx context.Context, service string, env map[string]string, command ...string) (system.Result, error)
	// LogText returns the last lines a service printed.
	LogText(ctx context.Context, tail int, services ...string) (string, error)
	Restart(ctx context.Context, services ...string) error
}

type StepResult struct {
	ID     string
	Status string // ok, skip, fail
	Msg    string
	Error  string
	Hint   string
}

type Config struct {
	App     string
	Service string
	// Dir is the App's folder on the host (apps/<id>), where its config
	// bind mounts live.
	Dir      string
	BaseURL  string
	URL      string
	Port     int
	Inputs   map[string]string
	Settings map[string]string
	Log      *events.Logger
	HTTP     *http.Client
	Secrets  Secrets
	Exec     Executor
	Record   func(StepResult)
	// Peer returns the helpers of another installed App, or nil.
	Peer func(id string) *H
	// PollInterval is how often waits retry. Zero means one second.
	PollInterval time.Duration
	// Now and Sleep drive waits; tests pass a fake clock.
	Now   func() time.Time
	Sleep func(ctx context.Context, d time.Duration) error
}

type H struct {
	Config
	remembered map[string]string
}

func New(cfg Config) *H {
	if cfg.Inputs == nil {
		cfg.Inputs = map[string]string{}
	}
	if cfg.Settings == nil {
		cfg.Settings = map[string]string{}
	}
	if cfg.Record == nil {
		cfg.Record = func(StepResult) {}
	}
	if cfg.Peer == nil {
		cfg.Peer = func(string) *H { return nil }
	}
	if cfg.PollInterval == 0 {
		cfg.PollInterval = time.Second
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Sleep == nil {
		cfg.Sleep = func(ctx context.Context, d time.Duration) error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(d):
				return nil
			}
		}
	}
	return &H{Config: cfg}
}

// StepSpec describes one idempotent step. Check reports whether the step's
// outcome already holds; Do makes it hold. A step only counts as done when
// Check passes, so nothing is claimed that cannot be observed.
type StepSpec struct {
	Check func(ctx context.Context) (bool, error)
	Do    func(ctx context.Context) error
	// Hint tells a human or agent how to finish the step by hand.
	Hint string
	// Credential names the login needed to finish it by hand (e.g. "admin").
	Credential string
}

func (h *H) Step(ctx context.Context, id, msg string, spec StepSpec) error {
	h.Log.Emit(events.Event{Event: events.StepStart, App: h.App, Step: id, Msg: msg})
	if spec.Check != nil {
		if done, err := spec.Check(ctx); err == nil && done {
			h.Log.Emit(events.Event{Event: events.StepSkip, App: h.App, Step: id, Msg: msg + " (already done)"})
			h.Record(StepResult{ID: id, Status: "skip", Msg: msg})
			return nil
		}
	}
	if spec.Do != nil {
		if err := spec.Do(ctx); err != nil {
			return h.fail(id, msg, spec, err)
		}
	}
	if spec.Check != nil {
		done, err := spec.Check(ctx)
		if err != nil {
			return h.fail(id, msg, spec, err)
		}
		if !done {
			return h.fail(id, msg, spec, errors.New("the change did not take effect"))
		}
	}
	h.Log.Emit(events.Event{Event: events.StepOK, App: h.App, Step: id, Msg: msg})
	h.Record(StepResult{ID: id, Status: "ok", Msg: msg})
	return nil
}

func (h *H) fail(id, msg string, spec StepSpec, err error) error {
	h.Log.Emit(events.Event{Event: events.StepFail, App: h.App, Step: id, Msg: msg, Error: err.Error(),
		URL: h.URL, Credential: spec.Credential, Hint: spec.Hint})
	h.Record(StepResult{ID: id, Status: "fail", Msg: msg, Error: err.Error(), Hint: spec.Hint})
	return fmt.Errorf("%s: %s: %w", h.App, id, errors.Join(ErrStepFailed, err))
}

// Skip reports a step that cannot run yet and records it as skipped.
func (h *H) Skip(id, msg string) {
	h.Log.Emit(events.Event{Event: events.StepSkip, App: h.App, Step: id, Msg: msg})
	h.Record(StepResult{ID: id, Status: "skip", Msg: msg})
}

// Info logs a progress line that is not a step.
func (h *H) Info(msg string) {
	h.Log.Emit(events.Event{Event: events.Info, App: h.App, Msg: msg})
}

// Secret returns a stored secret or "".
func (h *H) Secret(key string) string { return h.Secrets.Get(key) }

// SetSecret stores a secret and registers it for redaction.
func (h *H) SetSecret(key, value string) error {
	h.Log.Secret(value)
	return h.Secrets.Set(key, value)
}

// Key namespaces an App secret: Key("api_key") for sonarr is SONARR_API_KEY.
func (h *H) Key(name string) string {
	return strings.ToUpper(strings.ReplaceAll(h.App+"_"+name, "-", "_"))
}

// Remember returns the value fn produced for key earlier in this run (Setup
// and Check share one H), calling fn only when there is none. Failures are
// not remembered. Use it for logins that the App rate-limits.
func (h *H) Remember(key string, fn func() (string, error)) (string, error) {
	if value, found := h.remembered[key]; found {
		return value, nil
	}
	value, err := fn()
	if err != nil {
		return "", err
	}
	if h.remembered == nil {
		h.remembered = map[string]string{}
	}
	h.remembered[key] = value
	return value, nil
}

// Logs returns the main service's recent output.
func (h *H) Logs(ctx context.Context, tail int) (string, error) {
	return h.Config.Exec.LogText(ctx, tail, h.Service)
}

func (h *H) AdminUser() string     { return h.Secrets.Get("ADMIN_USER") }
func (h *H) AdminPassword() string { return h.Secrets.Get("ADMIN_PASSWORD") }

// Exec runs a command in the App's main service container. env values are
// passed through the environment and never appear in logs.
func (h *H) Exec(ctx context.Context, env map[string]string, command ...string) (system.Result, error) {
	return h.ExecIn(ctx, h.Service, env, command...)
}

// ExecSecret runs script with `sh -c` in the App's main service, passing
// secrets only through the environment. The script and argv never carry a
// secret value.
func (h *H) ExecSecret(ctx context.Context, secrets map[string]string, script string) (system.Result, error) {
	res, err := h.Exec(ctx, secrets, "sh", "-c", script)
	if err != nil {
		if out := commandOutput(res); out != "" {
			return res, fmt.Errorf("%w: %s", err, out)
		}
	}
	return res, err
}

// commandOutput returns the output a failed container command printed, so the
// error an App returns names the real cause instead of an empty exit.
func commandOutput(res system.Result) string {
	out := strings.TrimSpace(string(res.Stderr))
	if out == "" {
		out = strings.TrimSpace(string(res.Stdout))
	}
	return out
}

// Restart restarts the App's main service, e.g. so it rereads settings it
// caches at startup.
func (h *H) Restart(ctx context.Context) error {
	h.Info("restarting " + h.Service + " to apply its new settings")
	return h.Config.Exec.Restart(ctx, h.Service)
}

func (h *H) ExecIn(ctx context.Context, service string, env map[string]string, command ...string) (system.Result, error) {
	for _, value := range env {
		h.Log.Secret(value)
	}
	return h.Config.Exec.Exec(ctx, service, env, command...)
}
