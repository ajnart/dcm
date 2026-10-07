//go:build e2e

package e2e

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const exitIncomplete = 2

var e2eBinary string

func TestMain(m *testing.M) {
	if !dockerOK() {
		fmt.Println("e2e: docker is not available; skipping")
		os.Exit(0)
	}
	root, err := moduleRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		os.Exit(1)
	}
	binDir, err := os.MkdirTemp("", "selfhost-e2e-bin-")
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		os.Exit(1)
	}
	e2eBinary = filepath.Join(binDir, "self-host")
	build := exec.Command("go", "build", "-o", e2eBinary, "./cmd/self-host")
	build.Dir = root
	build.Stdout = os.Stdout
	build.Stderr = os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "e2e: building self-host:", err)
		os.RemoveAll(binDir)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(binDir)
	os.Exit(code)
}

func dockerOK() bool {
	cmd := exec.Command("docker", "info")
	return cmd.Run() == nil
}

func moduleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("go.mod not found above the working directory")
		}
		dir = parent
	}
}

type event struct {
	Event string `json:"event"`
	App   string `json:"app"`
	Step  string `json:"step"`
	Msg   string `json:"msg"`
	Error string `json:"error"`
	Hint  string `json:"hint"`
}

type result struct {
	code   int
	stdout string
	stderr string
	events []event
}

type runner struct {
	t       *testing.T
	root    string
	project string
	name    string
	target  string
	env     []string
	logDir  string
}

func newRunner(t *testing.T) *runner {
	t.Helper()
	root, err := os.MkdirTemp("", "selfhost-e2e-")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	name := "selfhost-e2e-" + randomHex(8)
	r := &runner{
		t:       t,
		root:    root,
		project: filepath.Join(root, "project"),
		name:    name,
		target:  "unnamed",
		logDir:  os.Getenv("E2E_LOG_DIR"),
	}
	r.env = append(os.Environ(),
		"SELF_HOST_HOME="+r.project,
		"SELF_HOST_COMPOSE_PROJECT="+name,
	)
	if r.logDir != "" {
		os.MkdirAll(r.logDir, 0o755)
	}
	t.Cleanup(r.cleanup)
	return r
}

func randomHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)[:n]
}

func (r *runner) run(args ...string) result {
	r.t.Helper()
	cmd := exec.Command(e2eBinary, args...)
	cmd.Dir = r.root
	cmd.Env = r.env
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	res := result{stdout: out.String(), stderr: errb.String()}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			res.code = exit.ExitCode()
		} else {
			r.t.Fatalf("self-host %s: %v", strings.Join(args, " "), err)
		}
	}
	res.events = decodeEvents(res.stdout)
	return res
}

func (r *runner) runWithTimeout(timeout time.Duration, args ...string) result {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, e2eBinary, args...)
	cmd.Dir = r.root
	cmd.Env = r.env
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	res := result{stdout: out.String(), stderr: errb.String()}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			res.code = exit.ExitCode()
		} else if ctx.Err() != nil {
			res.stderr += "\n[error] " + ctx.Err().Error()
		} else {
			res.stderr += "\n[error] " + err.Error()
		}
	}
	res.events = decodeEvents(res.stdout)
	return res
}

func decodeEvents(s string) []event {
	var out []event
	sc := bufio.NewScanner(strings.NewReader(s))
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var e event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}
		if e.Event == "" {
			continue
		}
		out = append(out, e)
	}
	return out
}

func (r *runner) cleanup() {
	if r.t.Failed() {
		r.dumpDiagnostics()
	}
	r.composeDown()
	r.removeRoot()
}

func (r *runner) composeDir() string {
	if _, err := os.Stat(r.project); err == nil {
		return r.project
	}
	return r.root
}

func (r *runner) composeDown() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "compose", "-p", r.name, "down", "--volumes", "--remove-orphans")
	cmd.Dir = r.composeDir()
	cmd.Env = r.env
	if out, err := cmd.CombinedOutput(); err != nil {
		r.t.Logf("docker compose -p %s down: %v\n%s", r.name, err, out)
	}
}

func (r *runner) removeRoot() {
	if err := os.RemoveAll(r.root); err == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "run", "--rm", "-v", r.root+":/x", "alpine", "sh", "-c", "rm -rf /x/* /x/.[!.]*")
	if out, err := cmd.CombinedOutput(); err != nil {
		r.t.Logf("cleaning %s via docker: %v\n%s", r.root, err, out)
	}
	if err := os.RemoveAll(r.root); err != nil {
		r.t.Logf("removing %s: %v", r.root, err)
	}
}

func (r *runner) dumpDiagnostics() {
	ps := r.dockerOutput(30*time.Second, "compose", "-p", r.name, "ps", "-a")
	logs := r.dockerOutput(60*time.Second, "compose", "-p", r.name, "logs", "--no-color", "--tail", "200")
	r.t.Logf("docker compose -p %s ps -a:\n%s", r.name, ps)
	r.t.Logf("docker compose -p %s logs --tail 200:\n%s", r.name, logs)
	if r.logDir == "" {
		return
	}
	prefix := filepath.Join(r.logDir, sanitize(r.target))
	status := r.runWithTimeout(60*time.Second, "status", "--json")
	os.WriteFile(prefix+".status.json", []byte(status.stdout+status.stderr), 0o644)
	os.WriteFile(prefix+".ps.txt", []byte(ps), 0o644)
	os.WriteFile(prefix+".logs.txt", []byte(logs), 0o644)
}

func (r *runner) dockerOutput(timeout time.Duration, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = r.composeDir()
	cmd.Env = r.env
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out) + "\n[error] " + err.Error()
	}
	return string(out)
}
