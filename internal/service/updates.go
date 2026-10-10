package service

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/ajnart/self-host/internal/registry"
	"github.com/ajnart/self-host/internal/system"
)

// Update states.
const (
	UpdateAvailable = "available"
	UpdateCurrent   = "current"
	UpdateUnknown   = "unknown"
)

// CheckUpdates compares each App's local image digest with the registry.
// Registry or Docker failures give "unknown", never "current".
func (s *Service) CheckUpdates(ctx context.Context, status *Status) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	crashes := make(chan system.CapturedPanic, 1)
	for i := range status.Apps {
		app := &status.Apps[i]
		if app.Image == "" {
			app.Update = UpdateUnknown
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if crash := system.CatchPanic(func() { app.Update = s.imageUpdate(ctx, app.Image) }); crash != nil {
				select {
				case crashes <- *crash:
				default:
				}
				cancel()
			}
		}()
	}
	wg.Wait()
	select {
	case crash := <-crashes:
		panic(crash)
	default:
	}
}

func (s *Service) imageUpdate(ctx context.Context, image string) string {
	result, err := s.Deps.Runner.Run(ctx, system.Cmd{Name: "docker", Args: []string{"image", "inspect", "--format", "{{json .RepoDigests}}", image}})
	if err != nil || result.ExitCode != 0 {
		return UpdateUnknown
	}
	var repoDigests []string
	if json.Unmarshal(result.Stdout, &repoDigests) != nil || len(repoDigests) == 0 {
		return UpdateUnknown
	}
	remote, err := registry.Digest(ctx, s.Deps.HTTP, registry.Parse(image))
	if err != nil {
		return UpdateUnknown
	}
	for _, rd := range repoDigests {
		if strings.HasSuffix(rd, "@"+remote) {
			return UpdateCurrent
		}
	}
	return UpdateAvailable
}
