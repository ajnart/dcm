package host

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

// DockerSocket returns the Unix socket used by the active Docker client.
func DockerSocket(ctx context.Context, deps *system.Deps) (string, error) {
	host := strings.TrimSpace(deps.Getenv("DOCKER_HOST"))
	if host == "" {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		result, err := deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{
			"context", "inspect", "--format", "{{json .Endpoints.docker.Host}}",
		}})
		if err != nil {
			return "", err
		}
		if result.ExitCode != 0 {
			return "", fmt.Errorf("docker context inspect: %s", firstLine(string(result.Stderr)))
		}
		if err := json.Unmarshal(result.Stdout, &host); err != nil {
			return "", fmt.Errorf("could not read the active Docker endpoint: %w", err)
		}
	}
	endpoint, err := url.Parse(host)
	if err != nil || endpoint.Scheme != "unix" || endpoint.Path == "" {
		return "", fmt.Errorf("the active Docker endpoint %q is not a Unix socket", host)
	}
	return endpoint.Path, nil
}
