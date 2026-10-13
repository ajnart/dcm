// Package systemtest provides fake Deps for tests.
package systemtest

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
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

type streamIORule struct {
	match  string
	handle func(context.Context, system.Cmd, io.Reader, io.Writer, io.Writer) error
}

// Runner is a scripted stand-in for external processes. Rules match on the
// space-joined command line prefix; the most recently added rule wins.
type Runner struct {
	mu       sync.Mutex
	rules    []rule
	streams  []streamRule
	streamIO []streamIORule
	calls    []system.Cmd
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

// OnStreamIO scripts an invocation without buffering its input or combining
// binary stdout with diagnostics. The last matching handler wins.
func (r *Runner) OnStreamIO(match string, handle func(context.Context, system.Cmd, io.Reader, io.Writer, io.Writer) error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.streamIO = append(r.streamIO, streamIORule{match: match, handle: handle})
}

func (r *Runner) StreamIO(ctx context.Context, cmd system.Cmd, stdin io.Reader, stdout, stderr io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	r.calls = append(r.calls, cmd)
	streams := append([]streamIORule(nil), r.streamIO...)
	rules := append([]rule(nil), r.rules...)
	r.mu.Unlock()
	if stdin == nil && cmd.Stdin != nil {
		stdin = bytes.NewReader(cmd.Stdin)
	}
	line := Line(cmd)
	for i := len(streams) - 1; i >= 0; i-- {
		if strings.Contains(line, streams[i].match) {
			err := streams[i].handle(ctx, cmd, stdin, stdout, stderr)
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
	}
	var result system.Result
	for i := len(rules) - 1; i >= 0; i-- {
		if strings.HasPrefix(line, rules[i].prefix) {
			result = rules[i].handle(cmd)
			break
		}
	}
	if stdout != nil {
		if _, err := stdout.Write(result.Stdout); err != nil {
			return err
		}
	}
	if stderr != nil {
		if _, err := stderr.Write(result.Stderr); err != nil {
			return err
		}
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("exit status %d", result.ExitCode)
	}
	return ctx.Err()
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
// a home directory under t.TempDir and free ports. Options swap in the fakes
// behind each capability; WithRunner replaces the default Docker answers too.
func NewDeps(t *testing.T, opts ...Option) *system.Deps {
	t.Helper()
	home := t.TempDir()
	runner := &Runner{}
	runner.On("docker version", system.Result{Stdout: []byte("27.3.1\n")})
	runner.On("docker info", system.Result{Stdout: []byte(`["name=seccomp,profile=builtin","name=cgroupns"]`)})
	runner.On("docker compose version", system.Result{Stdout: []byte("2.29.7\n")})
	f := &fakes{}
	for _, opt := range opts {
		opt(f)
	}
	if f.runner == nil {
		f.runner = runner
	}
	if f.clock == nil {
		f.clock = NewClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))
	}
	if f.network == nil {
		f.network = NewNetwork()
	}
	if f.host == nil {
		f.host = NewHost()
	}
	if f.env == nil {
		f.env = Env{}
	}
	if f.accounts == nil {
		f.accounts = NewAccounts(system.User{Name: "alice", Home: home, UID: 1000, GID: 1000})
	}
	if f.resolver == nil {
		f.resolver = &Resolver{}
	}
	deps := &system.Deps{
		Version:     "test",
		GOOS:        "linux",
		GOARCH:      "amd64",
		HTTP:        &http.Client{Timeout: 5 * time.Second},
		LookPath:    func(name string) (string, error) { return "/usr/bin/" + name, nil },
		Executable:  func() (string, error) { return filepath.Join(home, "bin", "self-host"), nil },
		Exec:        func(path string, argv []string) error { return fmt.Errorf("unexpected exec of %s", path) },
		CacheDir:    func() (string, error) { return filepath.Join(home, ".cache"), nil },
		ConfigDir:   func() (string, error) { return filepath.Join(home, ".config"), nil },
		ConfigFiles: &ConfigFiles{},
		DiskFree:    func(string) (uint64, error) { return 20 << 30, nil },
		PID:         4242,
		Out:         io.Discard,
		Err:         io.Discard,
	}
	deps.WithRunner(f.runner).
		WithClock(f.clock).
		WithNetwork(f.network).
		WithHost(f.host).
		WithEnvironment(f.env).
		WithAccounts(f.accounts).
		WithResolver(f.resolver)
	deps.BindTCP = func(_ string, address string) error {
		_, portText, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		port, err := strconv.Atoi(portText)
		if err != nil {
			return err
		}
		if !deps.PortFree(port) {
			return syscall.EADDRINUSE
		}
		return nil
	}
	deps.BindUDP = deps.BindTCP
	if network, ok := f.network.(*Network); ok {
		network.follow(deps.Network())
	}
	return deps
}

// SetEnv replaces the environment with a lookup in env.
func SetEnv(deps *system.Deps, env map[string]string) {
	deps.WithEnvironment(Env(env))
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

// Resolver is a fake Resolver that behaves like sslip.io: a name such as
// jellyfin.192-168-1-20.sslip.io answers 192.168.1.20. The router's resolver
// can be made to block, rewrite or lose its answers.
type Resolver struct {
	mu sync.Mutex
	// Blocked makes this computer's resolver drop answers that point at a
	// private address, as router DNS-rebind protection does.
	Blocked bool
	// Offline makes every lookup fail.
	Offline bool
	// Rewrite makes this computer's resolver answer this address for every name.
	Rewrite string
	// NoDirect makes direct queries to a public DNS server fail, as a
	// firewall that only lets the router's resolver through does.
	NoDirect bool
	// Asked lists the names this computer's resolver was asked, in order.
	Asked []string
	// Via lists "server name" for each direct query, in order.
	Via []string
}

func sslipAddress(name string) (string, bool) {
	labels := strings.Split(name, ".")
	if len(labels) < 4 || strings.Join(labels[len(labels)-2:], ".") != "sslip.io" {
		return "", false
	}
	parts := strings.Split(labels[len(labels)-3], "-")
	if len(parts) != 4 {
		return "", false
	}
	return strings.Join(parts, "."), true
}

func isPrivate(ip string) bool {
	return strings.HasPrefix(ip, "10.") || strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "172.16.")
}

func (r *Resolver) LookupHost(_ context.Context, name string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Asked = append(r.Asked, name)
	if r.Offline {
		return nil, fmt.Errorf("lookup %s: no such host", name)
	}
	if r.Rewrite != "" {
		return []string{r.Rewrite}, nil
	}
	ip, ok := sslipAddress(name)
	if !ok || r.Blocked && isPrivate(ip) {
		return nil, fmt.Errorf("lookup %s: no such host", name)
	}
	return []string{ip}, nil
}

func (r *Resolver) LookupHostVia(_ context.Context, server, name string) ([]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Via = append(r.Via, server+" "+name)
	ip, ok := sslipAddress(name)
	if r.Offline || r.NoDirect || !ok {
		return nil, fmt.Errorf("lookup %s: no such host", name)
	}
	return []string{ip}, nil
}

// Queries is a copy of Asked.
func (r *Resolver) Queries() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.Asked...)
}
