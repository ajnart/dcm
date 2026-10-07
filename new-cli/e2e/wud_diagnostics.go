package e2e

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/ajnart/self-host/e2e/wudfixture"
)

// These fixed states and counts are ordinary evidence; API error text, image
// references, arbitrary labels, private fields and response bodies never are.
type wudInventoryDiagnostic struct {
	Phase           string
	Outcome         string
	HTTPStatus      int
	Count           int
	ContainerMatch  bool
	ImageMatch      bool
	WatcherApproved bool
	WatchError      bool
}

func (d wudInventoryDiagnostic) summary() string {
	phase := "unavailable"
	switch d.Phase {
	case "container-selector", "container-projection", "image-projection", "snapshot-validation", "snapshot-write", "credentials", "inventory", "fresh-watch":
		phase = d.Phase
	}
	outcome := "unavailable"
	switch d.Outcome {
	case "command-failed", "transport-failed", "invalid-json", "http-failed", "empty", "invalid-selector", "scope-mismatch", "not-running", "watch-disabled", "image-id-invalid", "image-id-mismatch", "image-reference-invalid", "image-platform-invalid", "image-created-invalid", "image-tags-invalid", "image-digests-invalid", "image-name-invalid", "image-variant-invalid", "invalid-snapshot", "write-failed", "count-mismatch", "identity-mismatch", "watch-error", "verified":
		outcome = d.Outcome
	}
	status := d.HTTPStatus
	if status < 100 || status > 599 {
		status = 0
	}
	count := d.Count
	if count < 0 || count > 1024 {
		count = -1
	}
	return fmt.Sprintf("phase=%s outcome=%s http=%d count=%d container_match=%t image_match=%t watcher_approved=%t watch_error=%t", phase, outcome, status, count, d.ContainerMatch, d.ImageMatch, d.WatcherApproved, d.WatchError)
}

func wudSnapshotDiagnostic(container, image []byte, project, id string) wudInventoryDiagnostic {
	d := wudInventoryDiagnostic{Phase: "snapshot-validation", Outcome: "invalid-json"}
	var c struct {
		ID, ImageID, Image, Name, Project, Service, Watch, Digest string
		Running                                                   bool
	}
	var s wudfixture.Snapshot
	if len(container) > wudfixture.MaxSnapshotBytes || len(image) > wudfixture.MaxSnapshotBytes || json.Unmarshal(container, &c) != nil {
		return d
	}
	d.ContainerMatch = c.ID == id && wudOwnedID(id) && c.Project == project && c.Service == "ntfy"
	if !d.ContainerMatch {
		d.Outcome = "scope-mismatch"
		return d
	}
	if !c.Running {
		d.Outcome = "not-running"
		return d
	}
	if c.Watch != "true" || c.Digest != "false" {
		d.Outcome = "watch-disabled"
		return d
	}
	if !strings.HasPrefix(c.ImageID, "sha256:") || !wudOwnedID(strings.TrimPrefix(c.ImageID, "sha256:")) {
		d.Outcome = "image-id-invalid"
		return d
	}
	if len(image) == 0 {
		d.Phase = "container-projection"
		d.Outcome = "verified"
		return d
	}
	if json.Unmarshal(image, &s) != nil {
		d.Phase = "image-projection"
		return d
	}
	d.ImageMatch = s.ImageID == c.ImageID
	if !d.ImageMatch {
		d.Outcome = "image-id-mismatch"
		return d
	}
	if c.Image != "binwiederhier/ntfy:latest" {
		d.Outcome = "image-reference-invalid"
		return d
	}
	if !strings.HasPrefix(c.Name, "/"+project+"-") {
		d.Outcome = "image-name-invalid"
		return d
	}
	if s.OS != "linux" || s.Architecture != "amd64" && s.Architecture != "arm64" {
		d.Outcome = "image-platform-invalid"
		return d
	}
	if _, err := time.Parse(time.RFC3339Nano, s.Created); err != nil {
		d.Outcome = "image-created-invalid"
		return d
	}
	found := false
	if len(s.RepoTags) == 0 || len(s.RepoTags) > 8 {
		d.Outcome = "image-tags-invalid"
		d.Count = len(s.RepoTags)
		return d
	}
	for _, tag := range s.RepoTags {
		if tag == c.Image {
			found = true
		}
		if len(tag) > 256 || strings.ContainsAny(tag, "\r\n") {
			d.Outcome = "image-tags-invalid"
			return d
		}
	}
	if !found {
		d.Outcome = "image-tags-invalid"
		return d
	}
	if len(s.RepoDigests) > 8 {
		d.Outcome = "image-digests-invalid"
		d.Count = len(s.RepoDigests)
		return d
	}
	for _, digest := range s.RepoDigests {
		parts := strings.Split(digest, "@sha256:")
		if len(parts) != 2 || parts[0] != "binwiederhier/ntfy" || !wudOwnedID(parts[1]) {
			d.Outcome = "image-digests-invalid"
			return d
		}
	}
	if len(s.Variant) >= 16 {
		d.Outcome = "image-variant-invalid"
		return d
	}
	d.Outcome = "verified"
	return d
}

type wudInventoryImage struct{ ID string }
type wudInventoryEntry struct {
	ID, Watcher string
	Error       any
	Image       wudInventoryImage
}

func wudEntryDiagnostic(phase string, count int, entry wudInventoryEntry, containerID, imageID string) wudInventoryDiagnostic {
	d := wudInventoryDiagnostic{Phase: phase, Outcome: "count-mismatch", HTTPStatus: 200, Count: count}
	if count != 1 {
		return d
	}
	d.ContainerMatch = entry.ID == containerID
	d.ImageMatch = entry.Image.ID == imageID
	d.WatcherApproved = entry.Watcher == "approved"
	d.WatchError = entry.Error != nil
	d.Outcome = "identity-mismatch"
	if d.WatchError {
		d.Outcome = "watch-error"
		return d
	}
	if d.ContainerMatch && d.ImageMatch && d.WatcherApproved {
		d.Outcome = "verified"
	}
	return d
}
