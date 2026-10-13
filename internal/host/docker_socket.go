package host

import (
	"context"
	"fmt"
	"net/url"

	"github.com/ajnart/self-host/internal/system"
)

// ActiveDockerSocket returns the Unix socket used by the active Docker client.
func ActiveDockerSocket(ctx context.Context, deps *system.Deps) (string, error) {
	active, err := ActiveDockerEndpoint(ctx, deps)
	if err != nil {
		return "", err
	}
	endpoint, err := url.Parse(active.Host)
	if err != nil || endpoint.Scheme != "unix" || endpoint.Path == "" {
		return "", fmt.Errorf("the active Docker endpoint %q is not a Unix socket", active.Host)
	}
	return endpoint.Path, nil
}
