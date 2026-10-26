package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/host"
)

// dockerAdvice is what to do about a Docker that cannot be used: the hint and
// docs link of the first failing check, or empty when Docker looks fine.
func (s *Service) dockerAdvice(ctx context.Context) (hint, docs string) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	for _, check := range host.Docker(ctx, s.Deps) {
		if check.Level == host.Fail {
			return check.Hint, check.Docs
		}
	}
	return "", ""
}

func adviceText(hint, docs string) string {
	var parts []string
	if hint != "" {
		parts = append(parts, hint)
	}
	if docs != "" {
		parts = append(parts, "Docs: "+docs)
	}
	return strings.Join(parts, " ")
}

func daemonUnreachable(err error) bool {
	text := strings.ToLower(err.Error())
	for _, marker := range []string{"docker api", "docker daemon", "docker.sock", "docker_host"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

// withDockerAdvice appends the Docker-down hint and docs link to an error
// that says the daemon could not be reached.
func (s *Service) withDockerAdvice(ctx context.Context, err error) error {
	if err == nil || !daemonUnreachable(err) || strings.Contains(err.Error(), "Docs: ") {
		return err
	}
	text := adviceText(s.dockerAdvice(ctx))
	if text == "" {
		return err
	}
	return fmt.Errorf("%w. %s", err, text)
}

// logsFailure explains a failed log stream: when Docker is down it says so.
func (s *Service) logsFailure(ctx context.Context, err error) error {
	if err == nil || ctx.Err() != nil {
		return err
	}
	hint, docs := s.dockerAdvice(ctx)
	if hint == "" && docs == "" {
		return err
	}
	return fmt.Errorf("could not read logs: Docker is not reachable. %s", adviceText(hint, docs))
}
