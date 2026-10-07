// Package systemtest provides fake Deps for tests.
package systemtest

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

type rule struct {
	prefix string
	handle func(system.Cmd) system.Result
}

type streamRule struct {
	match  string
	output string
	err    error
}

// Runner is a scripted stand-in for external processes. Rules match on the
// space-joined command line prefix; the most recently added rule wins.
type Runner struct {
	mu      sync.Mutex
	rules   []rule
	streams []streamRule
	calls   []system.Cmd
	// Logs is written by Stream for `docker compose logs`.
	Logs string
}

func (r *Runner) On(prefix string, result system.Result) {
	r.OnFunc(prefix, func(system.Cmd) system.Result { return result })
}

func (r *Runner) OnFunc(prefix string, handle func(system.Cmd) system.Result) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rules = append(r.rules, rule{prefix: prefix, handle: handle})
}

func Line(cmd system.Cmd) string {
	return strings.TrimSpace(cmd.Name + " " + strings.Join(cmd.Args, " "))
}

func (r *Runner) Run(_ context.Context, cmd system.Cmd) (system.Result, error) {
	r.mu.Lock()
	r.calls = append(r.calls, cmd)
	rules := append([]rule(nil), r.rules...)
	r.mu.Unlock()
	line := Line(cmd)
	for i := len(rules) - 1; i >= 0; i-- {
		if strings.HasPrefix(line, rules[i].prefix) {
			return rules[i].handle(cmd), nil
		}
	}
	return system.Result{}, nil
}

// OnStream scripts the output Stream writes for commands whose line contains
// match. The last matching entry wins.
func (r *Runner) OnStream(match, output string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.streams = append(r.streams, streamRule{match: match, output: output})
}

// OnStreamError is OnStream with a failure, so Stream returns err after
// writing output.
func (r *Runner) OnStreamError(match, output string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.streams = append(r.streams, streamRule{match: match, output: output, err: err})
}

func (r *Runner) Stream(ctx context.Context, cmd system.Cmd, w io.Writer) error {
	result, _ := r.Run(ctx, cmd)
	r.mu.Lock()
	streams := append([]streamRule(nil), r.streams...)
	r.mu.Unlock()
	line := Line(cmd)
	for i := len(streams) - 1; i >= 0; i-- {
		if strings.Contains(line, streams[i].match) {
			if streams[i].output != "" {
				io.WriteString(w, streams[i].output)
			}
			return streams[i].err
		}
	}
	if len(result.Stdout) > 0 {
		w.Write(result.Stdout)
	} else {
		io.WriteString(w, r.Logs)
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("exit status %d", result.ExitCode)
	}
	return nil
}

// Calls returns every command line run so far.
func (r *Runner) Calls() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	lines := make([]string, len(r.calls))
	for i, cmd := range r.calls {
		lines[i] = Line(cmd)
	}
	return lines
}

// Cmds returns every command run so far.
func (r *Runner) Cmds() []system.Cmd {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]system.Cmd(nil), r.calls...)
}

// NewDeps returns Deps for a healthy Linux host with Docker and Compose v2,
// a home directory under t.TempDir and free ports.
func NewDeps(t *testing.T) *system.Deps {
	t.Helper()
	runner := &Runner{}
	runner.On("docker version", system.Result{Stdout: []byte("27.3.1\n")})
	runner.On("docker info", system.Result{Stdout: []byte(`["name=seccomp,profile=builtin","name=cgroupns"]`)})
	runner.On("docker compose version", system.Result{Stdout: []byte("2.29.7\n")})
	home := t.TempDir()
	env := map[string]string{}
	clock := &Clock{now: time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)}
	deps := &system.Deps{
		Version:    "test",
		GOOS:       "linux",
		GOARCH:     "amd64",
		Runner:     runner,
		HTTP:       &http.Client{Timeout: 5 * time.Second},
		LookPath:   func(name string) (string, error) { return "/usr/bin/" + name, nil },
		Executable: func() (string, error) { return filepath.Join(home, "bin", "self-host"), nil },
		Getenv:     func(key string) string { return env[key] },
		CurrentUser: func() (system.User, error) {
			return system.User{Name: "alice", Home: home, UID: 1000, GID: 1000}, nil
		},
		LookupUser: func(name string) (system.User, error) {
			return system.User{}, fmt.Errorf("unknown user %s", name)
		},
		Now:          clock.Now,
		Sleep:        clock.Sleep,
		LANIP:        func() (string, error) { return "192.168.1.20", nil },
		TimeZone:     func() string { return "Europe/Paris" },
		PortFree:     func(int) bool { return true },
		ProcessAlive: func(int) bool { return false },
		PID:          4242,
		Out:          io.Discard,
		Err:          io.Discard,
	}
	// The host's addresses follow LANIP unless a test sets them.
	deps.HostIPs = func() ([]string, error) {
		ip, err := deps.LANIP()
		return []string{ip}, err
	}
	return deps
}

// SetEnv replaces Getenv with a map lookup.
func SetEnv(deps *system.Deps, env map[string]string) {
	deps.Getenv = func(key string) string { return env[key] }
}

// Clock is a fake clock: Sleep returns at once and moves Now forward, so
// polling code runs its timeouts instantly in tests.
type Clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *Clock) Sleep(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
	return nil
}
