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
	f := &wudFixtureFiles{dir: filepath.Join(t.TempDir(), "tls"), observed: filepath.Join(t.TempDir(), "observed"), user: "1000:1001"}
	doc, err := f.compose("owned-test", true)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct{ Services map[string]map[string]any }
	if yaml.Unmarshal([]byte(doc), &parsed) != nil {
		t.Fatal("invalid compose")
	}
	seed, err := f.compose("owned-test", false)
	if err != nil {
		t.Fatal(err)
	}
	var seedParsed struct{ Services map[string]map[string]any }
	if yaml.Unmarshal([]byte(seed), &seedParsed) != nil || seedParsed.Services["wud"] != nil {
		t.Fatal("ntfy seed override introduced an unconfigured WUD service")
	}
	dependency := parsed.Services["wud"]["depends_on"].(map[string]any)["wud-facade"].(map[string]any)
	if dependency["condition"] != "service_healthy" {
		t.Fatal("WUD starts before its verified mutual TLS inventory is ready")
	}
	health := parsed.Services["wud-facade"]["healthcheck"].(map[string]any)
	encodedHealth, _ := json.Marshal(health)
	if !strings.Contains(string(encodedHealth), "/fixture/helper") || !strings.Contains(string(encodedHealth), "-healthcheck") || !strings.Contains(string(encodedHealth), "owned-test") {
		t.Fatal("fixture health does not prove its exact owned mutual TLS inventory")
	}
	sidecar := parsed.Services["wud-facade"]
	if sidecar["ports"] != nil || sidecar["network_mode"] != nil || sidecar["privileged"] != nil || sidecar["read_only"] != true || sidecar["user"] != f.user || strings.Contains(doc, "docker.sock") {
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

func TestWUDWrapperAllowsOnlyPublicNtfyAdminSetup(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "project")
	override := filepath.Join(root, "owned.yml")
	real := filepath.Join(root, "fake-docker")
	// The executor reports only whether the benign fixture value traveled in the
	// child environment. The password is never printed or included in arguments.
	script := "#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({'Args':sys.argv[1:],'PasswordInEnvironment':os.environ.get('NTFY_PASSWORD')=='synthetic-fixture-password'}))\n"
	if os.WriteFile(real, []byte(script), 0700) != nil {
		t.Fatal("prepare fake executor")
	}
	wrapper, err := writeWUDDockerWrapper(root, project, "owned-test", real, override)
	if err != nil {
		t.Fatal(err)
	}
	prefix := []string{"compose", "--project-directory", project, "-p", "owned-test", "--env-file", filepath.Join(project, ".env"), "--env-file", filepath.Join(project, "secrets.env"), "-f", filepath.Join(project, "compose.yml")}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, suffix := range [][]string{
		{"exec", "-T", "-e", "NTFY_PASSWORD", "ntfy", "ntfy", "user", "add", "--role=admin", "admin"},
		{"exec", "-T", "-e", "NTFY_PASSWORD", "ntfy", "ntfy", "user", "change-pass", "admin"},
		{"exec", "-T", "ntfy", "ntfy", "user", "change-role", "admin", "admin"},
	} {
		cmd := exec.CommandContext(ctx, wrapper, append(slices.Clone(prefix), suffix...)...)
		cmd.Env = append(os.Environ(), "NTFY_PASSWORD=synthetic-fixture-password")
		output, err := cmd.Output()
		if err != nil {
			t.Fatal("public ntfy administrator setup refused")
		}
		var got struct {
			Args                  []string
			PasswordInEnvironment bool
		}
		if json.Unmarshal(output, &got) != nil || !got.PasswordInEnvironment || !slices.Equal(got.Args[len(got.Args)-len(suffix):], suffix) || strings.Contains(string(output), "synthetic-fixture-password") {
			t.Fatal("administrator/password transport changed")
		}
	}
	for _, suffix := range [][]string{
		{"exec", "-T", "ntfy", "sh", "-c", "anything"},
		{"exec", "-T", "-e", "NTFY_PASSWORD=synthetic-fixture-password", "ntfy", "ntfy", "user", "add", "--role=admin", "admin"},
		{"exec", "-T", "-e", "OTHER_ENV", "ntfy", "ntfy", "user", "add", "--role=admin", "admin"},
		{"exec", "-T", "-e", "NTFY_PASSWORD", "wud", "ntfy", "user", "add", "--role=admin", "admin"},
		{"exec", "-T", "-e", "NTFY_PASSWORD", "ntfy", "ntfy", "user", "add", "--role=user", "admin"},
		{"exec", "-T", "-e", "NTFY_PASSWORD", "ntfy", "ntfy", "user", "add", "--role=admin", "other-user"},
		{"exec", "-T", "ntfy", "ntfy", "user", "change-role", "admin", "user"},
		{"logs", "ntfy"},
	} {
		cmd := exec.CommandContext(ctx, wrapper, append(slices.Clone(prefix), suffix...)...)
		cmd.Env = append(os.Environ(), "NTFY_PASSWORD=synthetic-fixture-password")
		if cmd.Run() == nil {
			t.Fatal("unapproved ntfy operation allowed")
		}
	}
	cmd := exec.CommandContext(ctx, wrapper, append(slices.Clone(prefix), "exec", "-T", "-e", "NTFY_PASSWORD", "ntfy", "ntfy", "user", "change-pass", "admin")...)
	cmd.Env = append(os.Environ(), "NTFY_PASSWORD=")
	if cmd.Run() == nil {
		t.Fatal("missing password environment accepted")
	}
}
