package host

import (
	"context"
	"strings"

	"github.com/ajnart/self-host/internal/system"
)

// SocketDeniedHint is the one piece of advice for a Docker socket the user may not use.
const SocketDeniedHint = "Run `sudo usermod -aG docker $USER`, then log out and in (or `newgrp docker`) and recheck. " +
	"Or use rootless Docker. Last resort: `sudo self-host` (the Project stays yours)."

// DockerProbe is the outcome of asking the Docker daemon for its version.
type DockerProbe struct {
	Result system.Result
	Err    error
}

func ProbeDocker(ctx context.Context, deps *system.Deps) DockerProbe {
	result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"version", "--format", "{{.Server.Version}}"}})
	return DockerProbe{Result: result, Err: err}
}

// SocketDenied reports whether the probe failed because the user may not use the Docker socket.
func (p DockerProbe) SocketDenied() bool {
	if p.Err == nil && p.Result.ExitCode == 0 {
		return false
	}
	text := string(p.Result.Stderr)
	if p.Err != nil {
		text += " " + p.Err.Error()
	}
	return strings.Contains(strings.ToLower(text), "permission denied")
}

// Reachable reports whether the daemon answered.
func (p DockerProbe) Reachable() bool {
	return p.Err == nil && p.Result.ExitCode == 0
}

func socketDeniedCheck() Check {
	return Check{ID: "docker-socket", Title: "Docker daemon", Level: Fail,
		Detail: "permission denied on the Docker socket", Hint: SocketDeniedHint, Docs: postInstall}
}
