package e2e

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/e2e/wudfixture"
)

func TestWUDObservationDiagnosticsDistinguishOwnedMetadataFailures(t *testing.T) {
	id := strings.Repeat("a", 64)
	imageID := "sha256:" + strings.Repeat("b", 64)
	container := map[string]any{"ID": id, "ImageID": imageID, "Image": "binwiederhier/ntfy:latest", "Name": "/owned-test-ntfy-1", "Project": "owned-test", "Service": "ntfy", "Watch": "true", "Digest": "false", "Running": true, "Env": []string{"private-fixture-password"}}
	image := wudfixture.Snapshot{ImageID: imageID, RepoTags: []string{"binwiederhier/ntfy:latest"}, OS: "linux", Architecture: "amd64", Created: "2026-10-07T00:00:00Z"}
	imageJSON, _ := json.Marshal(image)
	for _, tc := range []struct {
		key     string
		value   any
		outcome string
	}{
		{"Project", "private-fixture-password", "scope-mismatch"},
		{"Running", false, "not-running"},
		{"Watch", "false", "watch-disabled"},
		{"ImageID", "private-fixture-password", "image-id-invalid"},
		{"Image", "private-fixture-password", "image-reference-invalid"},
	} {
		copy := map[string]any{}
		for key, value := range container {
			copy[key] = value
		}
		copy[tc.key] = tc.value
		data, _ := json.Marshal(copy)
		diagnostic := wudSnapshotDiagnostic(data, imageJSON, "owned-test", id)
		if diagnostic.Outcome != tc.outcome || strings.Contains(diagnostic.summary(), "private-fixture-password") {
			t.Fatal("metadata failure was not precisely classified and redacted")
		}
	}
	data, _ := json.Marshal(container)
	if got := wudSnapshotDiagnostic(data, imageJSON, "owned-test", id); got.Outcome != "verified" || !got.ContainerMatch || !got.ImageMatch {
		t.Fatal("valid owned metadata was not recognized")
	}
	image.RepoDigests = []string{"docker.io/binwiederhier/ntfy@sha256:" + strings.Repeat("c", 64)}
	imageJSON, _ = json.Marshal(image)
	if got := wudSnapshotDiagnostic(data, imageJSON, "owned-test", id); got.Outcome != "image-digests-invalid" {
		t.Fatal("strict digest failure remains opaque")
	}
}

func TestWUDDiagnosticEvidenceDropsArbitraryStrings(t *testing.T) {
	diagnostic := wudInventoryDiagnostic{Phase: "private-fixture-password", Outcome: "private-fixture-password", HTTPStatus: 2000, Count: 9000}
	if summary := diagnostic.summary(); strings.Contains(summary, "private-fixture-password") || !strings.Contains(summary, "http=0 count=-1") {
		t.Fatal("untrusted diagnostics entered ordinary evidence")
	}
}

func TestWUDInventoryDiagnosticsDistinguishFreshWatchFailures(t *testing.T) {
	for _, tc := range []struct {
		phase   string
		count   int
		entry   wudInventoryEntry
		outcome string
	}{
		{"inventory", 0, wudInventoryEntry{}, "count-mismatch"},
		{"inventory", 2, wudInventoryEntry{}, "count-mismatch"},
		{"inventory", 1, wudInventoryEntry{ID: "owned", Watcher: "approved", Image: wudInventoryImage{ID: "image"}}, "verified"},
		{"fresh-watch", 1, wudInventoryEntry{ID: "other", Watcher: "approved", Image: wudInventoryImage{ID: "image"}}, "identity-mismatch"},
		{"fresh-watch", 1, wudInventoryEntry{ID: "owned", Watcher: "approved", Error: "private-fixture-password", Image: wudInventoryImage{ID: "image"}}, "watch-error"},
	} {
		d := wudEntryDiagnostic(tc.phase, tc.count, tc.entry, "owned", "image")
		if d.Outcome != tc.outcome || strings.Contains(d.summary(), "private-fixture-password") {
			t.Fatal("inventory or fresh watch diagnostic is incorrect or exposes payload")
		}
	}
}
