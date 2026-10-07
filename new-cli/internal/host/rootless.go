package host

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

const rootlessDocs = "https://docs.docker.com/engine/security/rootless/uid-gid-mapping/"

// Rootless inspects the active daemon, rather than assuming the caller's UID
// is also the UID that can write the Project's bind mounts inside containers.
func Rootless(ctx context.Context, deps *system.Deps) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"info", "--format", "{{json .SecurityOptions}}"}})
	if err != nil {
		return false, err
	}
	if result.ExitCode != 0 {
		return false, fmt.Errorf("docker info: %s", firstLine(string(result.Stderr)))
	}
	var options []string
	if err := json.Unmarshal(result.Stdout, &options); err != nil {
		return false, fmt.Errorf("could not read Docker user namespace: %w", err)
	}
	if options == nil {
		return false, fmt.Errorf("Docker did not report security options")
	}
	for _, option := range options {
		if slices.Contains(strings.Split(option, ","), "name=rootless") {
			return true, nil
		}
	}
	return false, nil
}
