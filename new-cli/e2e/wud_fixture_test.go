package e2e

import (
	"context"
	"encoding/json"
	"github.com/ajnart/self-host/e2e/wudfixture"
	"github.com/ajnart/self-host/internal/catalog"
	"go.yaml.in/yaml/v3"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestWUDOwnedFixtureAdmissionAndPrivateCompose(t *testing.T) {
	target := withOwnedPrerequisites(findTarget(acceptanceInventory(catalog.Default()), "wud"))
	if targetEnvironmentCount(target) != 3 || !slices.Equal(target.Apps, []string{"wud", "ntfy"}) || classifyTarget(catalog.Default(), target) != "runnable" || !exclusiveTarget(catalog.Default(), target) {
		t.Fatal("owned facade prerequisite omitted from admission")
	}
	if !slices.Contains(expectedServices(target), "wud-facade") || !slices.Contains(expectedServices(target), "ntfy") {
		t.Fatal("owned containers omitted from image/readiness proof")
	}
	f := &wudFixtureFiles{dir: filepath.Join(t.TempDir(), "tls"), observed: filepath.Join(t.TempDir(), "observed")}
	doc, err := f.compose("owned-test")
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct{ Services map[string]map[string]any }
	if yaml.Unmarshal([]byte(doc), &parsed) != nil {
		t.Fatal("invalid compose")
	}
	sidecar := parsed.Services["wud-facade"]
	if sidecar["ports"] != nil || sidecar["network_mode"] != nil || sidecar["privileged"] != nil || sidecar["read_only"] != true || strings.Contains(doc, "docker.sock") {
		t.Fatal("facade escaped private owned network")
	}
}
func TestWUDObservationFailsClosedOnWrongProvenance(t *testing.T) {
	id := strings.Repeat("a", 64)
	imageID := "sha256:" + strings.Repeat("b", 64)
	container := map[string]any{"ID": id, "ImageID": imageID, "Image": "binwiederhier/ntfy:latest", "Name": "/owned-test-ntfy-1", "Project": "owned-test", "Service": "ntfy", "Watch": "true", "Digest": "false", "Running": true}
	image := wudfixture.Snapshot{ImageID: imageID, RepoTags: []string{"binwiederhier/ntfy:latest"}, Architecture: "amd64", OS: "linux", Created: "2026-10-07T00:00:00Z"}
	imageJSON, _ := json.Marshal(image)
	for _, key := range []string{"Project", "Service", "ID", "ImageID", "Watch", "Digest", "Running"} {
		t.Run(key, func(t *testing.T) {
			copy := map[string]any{}
			for k, v := range container {
				copy[k] = v
			}
			copy[key] = "wrong"
			if key == "Running" {
				copy[key] = false
			}
			data, _ := json.Marshal(copy)
			if _, err := decodeWUDObservation(data, imageJSON, "owned-test", id, 1, time.Now()); err == nil {
				t.Fatal("unowned or disabled observation accepted")
			}
		})
	}
	data, _ := json.Marshal(container)
	if _, err := decodeWUDObservation(data, imageJSON, "owned-test", id, 1, time.Now()); err != nil {
		t.Fatal("owned observation rejected")
	}
	wrong := image
	wrong.ImageID = "sha256:" + strings.Repeat("c", 64)
	dataWrong, _ := json.Marshal(wrong)
	if _, err := decodeWUDObservation(data, dataWrong, "owned-test", id, 1, time.Now()); err == nil {
		t.Fatal("unrelated image accepted")
	}
}

func TestWUDWrapperPreservesOnlyExactOwnedOverride(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	override := filepath.Join(root, "owned.yml")
	real := filepath.Join(root, "fake-docker")
	if os.WriteFile(real, []byte("#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n"), 0700) != nil {
		t.Fatal("prepare fake executor")
	}
	wrapper, err := writeWUDDockerWrapper(root, project, "owned-test", real, override)
	if err != nil {
		t.Fatal(err)
	}
	prefix := []string{"compose", "--project-directory", project, "-p", "owned-test", "-f", filepath.Join(project, "compose.yml"), "-f", override}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, wrapper, append(prefix, "ps", "-q", "ntfy")...).Output()
	if err != nil {
		t.Fatal("owned observation refused")
	}
	var got []string
	if json.Unmarshal(output, &got) != nil || !slices.Equal(got[len(got)-7:], []string{"-f", filepath.Join(project, "compose.yml"), "-f", override, "ps", "-q", "ntfy"}) {
		t.Fatal("owned override missing or duplicated")
	}
	for _, args := range [][]string{{"system", "prune"}, {"container", "inspect", "unowned"}, {"compose", "--project-directory", project, "-p", "unowned", "down"}, {"compose", "--project-directory", project, "-p", "owned-test", "-f", "/unowned.yml", "up"}} {
		if exec.CommandContext(ctx, wrapper, args...).Run() == nil {
			t.Fatal("unowned selector accepted")
		}
	}
}
