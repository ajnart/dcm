package host_test

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/host"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type failingRunner struct {
	*systemtest.Runner
	err error
}

func (r failingRunner) Run(context.Context, system.Cmd) (system.Result, error) {
	return system.Result{}, r.err
}

func (r failingRunner) Stream(context.Context, system.Cmd, io.Writer) error { return r.err }

func TestDockerSocketClassification(t *testing.T) {
	denied := "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock"
	tests := []struct {
		name       string
		result     system.Result
		err        error
		wantDenied bool
	}{
		{name: "denied stderr", result: system.Result{ExitCode: 1, Stderr: []byte(denied)}, wantDenied: true},
		{name: "denied probe error", err: errors.New("exec docker: " + denied), wantDenied: true},
		{name: "stopped daemon", result: system.Result{ExitCode: 1, Stderr: []byte("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?")}},
		{name: "unrelated probe error", err: errors.New("fork/exec: no such file")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			if tt.err != nil {
				deps.Runner = failingRunner{Runner: deps.Runner.(*systemtest.Runner), err: tt.err}
			} else {
				deps.Runner.(*systemtest.Runner).On("docker version", tt.result)
			}
			checks := host.Docker(context.Background(), deps)
			got := checks[len(checks)-1]
			if got.ID != "docker-socket" || got.Level != host.Fail {
				t.Fatalf("last check = %+v", got)
			}
			if denied := got.Hint == host.SocketDeniedHint; denied != tt.wantDenied {
				t.Fatalf("hint = %q, denied = %v want %v", got.Hint, denied, tt.wantDenied)
			}
			if !tt.wantDenied && !strings.Contains(got.Hint+got.Detail, "daemon") && tt.err == nil {
				t.Fatalf("stopped daemon lost its start hint: %+v", got)
			}
			if report := host.Report(context.Background(), deps).Docker; report.SocketDenied != tt.wantDenied || report.DaemonReachable {
				t.Fatalf("report = %+v", report)
			}
		})
	}
}

func TestSocketDeniedHintOrder(t *testing.T) {
	sudo := strings.Index(host.SocketDeniedHint, `sudo "$(command -v self-host)"`)
	rootless := strings.Index(host.SocketDeniedHint, "rootless Docker")
	root := strings.Index(host.SocketDeniedHint, "root-equivalent")
	group := strings.Index(host.SocketDeniedHint, "sudo usermod -aG docker $USER")
	if sudo < 0 || !(sudo < rootless && rootless < root && root < group) {
		t.Fatalf("hint order wrong: %s", host.SocketDeniedHint)
	}
}
