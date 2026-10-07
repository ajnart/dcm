// Package host inspects the machine: Docker availability, Host settings and
// network reachability.
package host

import (
	"context"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/system"
)

type Level string

const (
	OK   Level = "ok"
	Warn Level = "warn"
	Fail Level = "fail"
)

// Check is one doctor finding.
type Check struct {
	ID     string `json:"id"`
	App    string `json:"app,omitempty"`
	Title  string `json:"title"`
	Level  Level  `json:"level"`
	Detail string `json:"detail"`
	Hint   string `json:"hint,omitempty"`
	Docs   string `json:"docs,omitempty"`
}

const (
	dockerDocs     = "https://docs.docker.com/engine/install/"
	orbstackDocs   = "https://orbstack.dev/download"
	postInstall    = "https://docs.docker.com/engine/install/linux-postinstall/"
	composeDocs    = "https://docs.docker.com/compose/install/"
	daemonDocs     = "https://docs.docker.com/engine/daemon/start/"
	orbstackDaemon = "https://docs.orbstack.dev/quick-start"
)

func installDocs(goos string) string {
	if goos == "darwin" {
		return orbstackDocs
	}
	return dockerDocs
}

// Docker checks that the docker CLI exists, that the daemon answers through
// the active context, and that Compose v2 is available. Later checks are
// skipped when an earlier one fails.
func Docker(ctx context.Context, deps *system.Deps) []Check {
	if _, err := deps.LookPath("docker"); err != nil {
		hint := "Install Docker Engine, then run self-host again."
		if deps.GOOS == "darwin" {
			hint = "Install OrbStack, start it once, then run self-host again."
		}
		return []Check{{ID: "docker", Title: "Docker", Level: Fail, Detail: "docker command not found", Hint: hint, Docs: installDocs(deps.GOOS)}}
	}
	checks := []Check{{ID: "docker", Title: "Docker", Level: OK, Detail: "docker command found"}}

	version, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"version", "--format", "{{.Server.Version}}"}})
	stderr := strings.ToLower(string(version.Stderr))
	switch {
	case err != nil:
		return append(checks, Check{ID: "docker-socket", Title: "Docker daemon", Level: Fail, Detail: err.Error(), Docs: daemonDocs})
	case version.ExitCode != 0 && strings.Contains(stderr, "permission denied"):
		return append(checks, Check{ID: "docker-socket", Title: "Docker daemon", Level: Fail,
			Detail: "permission denied on the Docker socket",
			Hint:   "Add your user to the docker group, use rootless Docker, or rerun with sudo.",
			Docs:   postInstall})
	case version.ExitCode != 0:
		docs, hint := daemonDocs, "Start the Docker daemon, then run self-host again."
		if deps.GOOS == "darwin" {
			docs, hint = orbstackDaemon, "Open OrbStack so the Docker engine starts, then run self-host again."
		}
		return append(checks, Check{ID: "docker-socket", Title: "Docker daemon", Level: Fail,
			Detail: firstLine(string(version.Stderr)), Hint: hint, Docs: docs})
	}
	checks = append(checks, Check{ID: "docker-socket", Title: "Docker daemon", Level: OK,
		Detail: "engine " + strings.TrimSpace(string(version.Stdout))})

	compose, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"compose", "version", "--short"}})
	short := strings.TrimPrefix(strings.TrimSpace(string(compose.Stdout)), "v")
	if err != nil || compose.ExitCode != 0 || majorVersion(short) < 2 {
		return append(checks, Check{ID: "compose", Title: "Docker Compose", Level: Fail,
			Detail: "Docker Compose v2 plugin not available",
			Hint:   "Install the Docker Compose v2 plugin (docker compose, not docker-compose).",
			Docs:   composeDocs})
	}
	return append(checks, Check{ID: "compose", Title: "Docker Compose", Level: OK, Detail: "compose " + short})
}

func majorVersion(v string) int {
	major, _, _ := strings.Cut(v, ".")
	n, err := strconv.Atoi(major)
	if err != nil {
		return 0
	}
	return n
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	return line
}

// Worst returns the most severe level among checks.
func Worst(checks []Check) Level {
	worst := OK
	for _, c := range checks {
		if c.Level == Fail {
			return Fail
		}
		if c.Level == Warn {
			worst = Warn
		}
	}
	return worst
}
