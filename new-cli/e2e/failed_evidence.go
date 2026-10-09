package e2e

import (
	"context"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
)

type blockerError string

// Publication is deliberately last: filesystem failure must never interrupt
// scoped teardown or registration of its retained-project blocker.
func cleanupObservedOwned(observe func(), down func() error, remove func(), guard *sweepGuard, project string, publish func(error) error) (error, error) {
	observe()
	cleanupErr := cleanupOwned(down, remove, guard, project)
	return cleanupErr, publish(cleanupErr)
}

func (e blockerError) Error() string { return string(e) }

func safeBlockerReason(err error) string {
	var blocker blockerError
	if errors.As(err, &blocker) {
		return string(blocker)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "target capacity deadline exceeded"
	}
	if errors.Is(err, context.Canceled) {
		return "target capacity wait canceled"
	}
	return "target blocked; unrecognized diagnostic omitted"
}

func immutableImageID(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != 71 {
		return false
	}
	_, err := hex.DecodeString(value[7:])
	return err == nil
}

var imagePlatform = regexp.MustCompile(`^[a-z0-9]+/[a-z0-9_]+$`)

// Callbacks observe only an expected owned Compose service and its exact digest.
// Invalid selectors and formatter output are discarded, never persisted.
func observeOwnedImages(previous []imageEvidence, expected []string, list func(string) string, inspect func([]string) string) ([]imageEvidence, []string) {
	known := map[string]imageEvidence{}
	for _, image := range previous {
		if immutableImageID(image.ID) && imagePlatform.MatchString(image.Platform) {
			known[image.Service] = image
		}
	}
	var images []imageEvidence
	var unavailable []string
	for _, service := range expected {
		ids := strings.Fields(list(service))
		// Compose may omit the algorithm prefix for a full image digest.
		if len(ids) == 1 && len(ids[0]) == 64 && immutableImageID("sha256:"+ids[0]) {
			ids[0] = "sha256:" + ids[0]
		}
		if len(ids) == 1 && immutableImageID(ids[0]) {
			parts := strings.Fields(inspect([]string{"image", "inspect", "--format", "{{.Id}} {{.Os}}/{{.Architecture}}", ids[0]}))
			if len(parts) == 2 && immutableImageID(parts[0]) && parts[0] == ids[0] && imagePlatform.MatchString(parts[1]) {
				known[service] = imageEvidence{Service: service, ID: parts[0], Platform: parts[1]}
			}
		}
		if image, ok := known[service]; ok {
			images = append(images, image)
		} else {
			unavailable = append(unavailable, service)
		}
	}
	return images, unavailable
}
