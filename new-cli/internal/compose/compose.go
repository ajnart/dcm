// Package compose is the only place that runs `docker compose`. Every command
// is logged verbatim so a human or agent can reproduce it.
package compose

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/system"
)

type Publisher struct {
	URL           string `json:"URL"`
	TargetPort    int    `json:"TargetPort"`
	PublishedPort int    `json:"PublishedPort"`
	Protocol      string `json:"Protocol"`
}

type Container struct {
	Name       string      `json:"Name"`
	Service    string      `json:"Service"`
	State      string      `json:"State"`
	Health     string      `json:"Health"`
	Image      string      `json:"Image"`
	Status     string      `json:"Status"`
	Publishers []Publisher `json:"Publishers"`
}

type Compose struct {
	deps *system.Deps
	log  *events.Logger
	root string
	name string
}

func New(deps *system.Deps, log *events.Logger, root, name string) *Compose {
	return &Compose{deps: deps, log: log, root: root, name: name}
}

func (c *Compose) args(extra ...string) []string {
	base := []string{"compose", "--project-directory", c.root, "-p", c.name,
		"--env-file", filepath.Join(c.root, ".env"), "--env-file", filepath.Join(c.root, "secrets.env")}
	return append(base, extra...)
}

// Run executes `docker compose <args>` and fails on a non-zero exit.
// env values are passed through the process environment, never argv.
func (c *Compose) Run(ctx context.Context, env map[string]string, args ...string) (system.Result, error) {
	cmd := system.Cmd{Name: "docker", Args: c.args(args...), Dir: c.root}
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		cmd.Env = append(cmd.Env, key+"="+env[key])
	}
	c.log.Emit(events.Event{Event: events.Command, Command: "docker " + strings.Join(cmd.Args, " ")})
	result, err := c.deps.Runner.Run(ctx, cmd)
	if err != nil {
		return result, err
	}
	if result.ExitCode != 0 {
		return result, fmt.Errorf("docker compose %s: exit %d: %s", args[0], result.ExitCode, lastLine(result.Stderr))
	}
	return result, nil
}

func lastLine(b []byte) string {
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

func (c *Compose) Up(ctx context.Context, services ...string) error {
	_, err := c.Run(ctx, nil, append([]string{"up", "-d"}, services...)...)
	return err
}

func (c *Compose) Stop(ctx context.Context, services ...string) error {
	_, err := c.Run(ctx, nil, append([]string{"stop"}, services...)...)
	return err
}

func (c *Compose) Start(ctx context.Context, services ...string) error {
	_, err := c.Run(ctx, nil, append([]string{"start"}, services...)...)
	return err
}

func (c *Compose) Restart(ctx context.Context, services ...string) error {
	_, err := c.Run(ctx, nil, append([]string{"restart"}, services...)...)
	return err
}

func (c *Compose) Pull(ctx context.Context, services ...string) error {
	_, err := c.Run(ctx, nil, append([]string{"pull"}, services...)...)
	return err
}

// PullProgress runs `pull --progress json` and reports per-image, per-layer
// progress as pull.progress events. Unknown output lines are ignored.
func (c *Compose) PullProgress(ctx context.Context, services ...string) error {
	args := append([]string{"pull", "--progress", "json"}, services...)
	cmd := system.Cmd{Name: "docker", Args: c.args(args...), Dir: c.root}
	c.log.Emit(events.Event{Event: events.Command, Command: "docker " + strings.Join(cmd.Args, " ")})
	parser := newPullParser(c.log, c.deps.Now)
	w := &lineWriter{onLine: parser.line}
	err := c.deps.Runner.Stream(ctx, cmd, w)
	w.flush()
	if err != nil {
		image := parser.failed
		if image == "" {
			image = parser.lastSeen
		}
		return &PullError{Image: image, Err: err}
	}
	return nil
}

// PullError names the image involved when a pull fails.
type PullError struct {
	Image string
	Err   error
}

func (e *PullError) Error() string { return e.Err.Error() }
func (e *PullError) Unwrap() error { return e.Err }

// pullLine is one line of `docker compose pull --progress json`.
type pullLine struct {
	ID       string `json:"id"`
	ParentID string `json:"parent_id"`
	Status   string `json:"status"`
	Text     string `json:"text"`
	Current  int64  `json:"current"`
	Total    int64  `json:"total"`
}

// pullParser turns progress lines into events, throttled to five per second
// per image, and always emits the image's final event.
type pullParser struct {
	log      *events.Logger
	now      func() time.Time
	last     map[string]time.Time
	lastSeen string
	failed   string
}

func newPullParser(log *events.Logger, now func() time.Time) *pullParser {
	if now == nil {
		now = time.Now
	}
	return &pullParser{log: log, now: now, last: map[string]time.Time{}}
}

func (p *pullParser) line(raw []byte) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return
	}
	var line pullLine
	if err := json.Unmarshal(trimmed, &line); err != nil {
		return
	}
	image, layer := strings.TrimPrefix(line.ParentID, "Image "), line.ID
	if line.ParentID == "" {
		image, layer = strings.TrimPrefix(line.ID, "Image "), ""
	}
	if image == "" || image == line.ID {
		return
	}
	p.lastSeen = image
	if line.Status == "Error" || line.Status == "Failed" {
		p.failed = image
	}
	final := layer == "" && line.Status == "Done"
	if !final && !p.allow(image) {
		return
	}
	p.log.Emit(events.Event{Event: events.PullProgress, Image: image, Layer: layer,
		Status: line.Text, Current: line.Current, Total: line.Total})
}

func (p *pullParser) allow(image string) bool {
	now := p.now()
	if last, ok := p.last[image]; ok && now.Sub(last) < 200*time.Millisecond {
		return false
	}
	p.last[image] = now
	return true
}

// lineWriter calls onLine for every complete line written to it.
type lineWriter struct {
	buf    []byte
	onLine func([]byte)
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	for {
		i := bytes.IndexByte(w.buf, '\n')
		if i < 0 {
			break
		}
		w.onLine(w.buf[:i])
		w.buf = w.buf[i+1:]
	}
	return len(p), nil
}

func (w *lineWriter) flush() {
	if len(bytes.TrimSpace(w.buf)) > 0 {
		w.onLine(w.buf)
	}
	w.buf = nil
}

// Remove stops and deletes the containers of services; volumes are kept.
func (c *Compose) Remove(ctx context.Context, services ...string) error {
	_, err := c.Run(ctx, nil, append([]string{"rm", "--stop", "--force"}, services...)...)
	return err
}

// Exec runs a command in a running service container without a TTY.
func (c *Compose) Exec(ctx context.Context, service string, env map[string]string, command ...string) (system.Result, error) {
	args := []string{"exec", "-T"}
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, "-e", key)
	}
	args = append(args, service)
	return c.Run(ctx, env, append(args, command...)...)
}

// Ps lists the Project's containers, running or not.
func (c *Compose) Ps(ctx context.Context) ([]Container, error) {
	result, err := c.Run(ctx, nil, "ps", "--all", "--format", "json")
	if err != nil {
		return nil, err
	}
	return parsePs(result.Stdout)
}

// Compose prints NDJSON since v2.21 and a JSON array before that.
func parsePs(out []byte) ([]Container, error) {
	trimmed := bytes.TrimSpace(out)
	if len(trimmed) == 0 {
		return nil, nil
	}
	var containers []Container
	if trimmed[0] == '[' {
		err := json.Unmarshal(trimmed, &containers)
		return containers, err
	}
	scanner := bufio.NewScanner(bytes.NewReader(trimmed))
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		var container Container
		if err := json.Unmarshal(scanner.Bytes(), &container); err != nil {
			return nil, fmt.Errorf("docker compose ps: %w", err)
		}
		containers = append(containers, container)
	}
	return containers, scanner.Err()
}

// Logs streams the logs of services to w until ctx ends.
func (c *Compose) Logs(ctx context.Context, w io.Writer, follow bool, tail int, services ...string) error {
	args := []string{"logs", "--no-color", "--tail", fmt.Sprint(tail)}
	if follow {
		args = append(args, "--follow")
	}
	cmd := system.Cmd{Name: "docker", Args: c.args(append(args, services...)...), Dir: c.root}
	return c.deps.Runner.Stream(ctx, cmd, w)
}

// LogText returns the last tail lines of services' logs.
func (c *Compose) LogText(ctx context.Context, tail int, services ...string) (string, error) {
	result, err := c.Run(ctx, nil, append([]string{"logs", "--no-color", "--tail", fmt.Sprint(tail)}, services...)...)
	return string(result.Stdout), err
}
