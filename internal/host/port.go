package host

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

// friendlyHolders turns the process names that hold a port into what a person
// knows them as.
var friendlyHolders = map[string]string{
	"com.docker.backend": "Docker Desktop",
	"com.docker.vpnkit":  "Docker Desktop",
	"docker-proxy":       "another Docker container",
}

// PortHolder names the program listening on a TCP port, or "" when it cannot
// be found. Without administrator rights Linux hides other users' programs, so
// an empty answer does not mean the port is free.
func PortHolder(ctx context.Context, deps *system.Deps, port int) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := system.Cmd{Name: "ss", Args: []string{"-ltnpH", fmt.Sprintf("sport = :%d", port)}}
	if deps.GOOS == "darwin" {
		cmd = system.Cmd{Name: "lsof", Args: []string{"-nP", fmt.Sprintf("-iTCP:%d", port), "-sTCP:LISTEN", "-Fc"}}
	}
	result, err := deps.Runner.Run(ctx, cmd)
	if err != nil || result.ExitCode != 0 {
		return ""
	}
	name := holderName(deps.GOOS, string(result.Stdout))
	if friendly, found := friendlyHolders[name]; found {
		return friendly
	}
	return name
}

func holderName(goos, output string) string {
	for _, line := range strings.Split(output, "\n") {
		if goos == "darwin" {
			if name, found := strings.CutPrefix(line, "c"); found && name != "" {
				return name
			}
			continue
		}
		if _, rest, found := strings.Cut(line, `users:(("`); found {
			name, _, _ := strings.Cut(rest, `"`)
			return name
		}
	}
	return ""
}
