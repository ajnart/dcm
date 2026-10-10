package system_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/system"
)

func TestConfigFileConcurrentInitializationPublishesOneCompleteIdentity(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "self-host")
	const first = "6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10\n"
	const second = "0bb12233-4455-4677-8899-aabbccddeeff\n"
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	results := make(chan string, 2)
	errs := make(chan error, 2)
	var workers sync.WaitGroup
	for _, candidate := range []string{first, second} {
		workers.Go(func() {
			data, err := system.ConfigFilesAt(dir).LoadOrCreateConfigFile("telemetry-id", func() ([]byte, error) {
				ready <- struct{}{}
				<-release
				return []byte(candidate), nil
			})
			results <- string(data)
			errs <- err
		})
	}
	<-ready
	<-ready
	close(release)
	workers.Wait()
	a, b := <-results, <-results
	if a != b || (a != first && a != second) {
		t.Fatalf("identities = %q and %q", a, b)
	}
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	data, err := system.ConfigFilesAt(dir).LoadOrCreateConfigFile("telemetry-id", func() ([]byte, error) {
		t.Fatal("existing identity was regenerated")
		return nil, nil
	})
	if err != nil || string(data) != a {
		t.Fatalf("subsequent identity = %q, %v", data, err)
	}
}

func TestConfigIdentityIsStableAcrossProcesses(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "self-host")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	outputs := make(chan string, 2)
	errs := make(chan error, 2)
	var workers sync.WaitGroup
	for _, candidate := range []string{"6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10\n", "0bb12233-4455-4677-8899-aabbccddeeff\n"} {
		workers.Go(func() {
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestConfigIdentityProcessChild$", "--", dir, candidate)
			cmd.Env = []string{"SELF_HOST_CONFIG_CHILD=1"}
			out, err := cmd.CombinedOutput()
			outputs <- string(out)
			errs <- err
		})
	}
	workers.Wait()
	a, b := <-outputs, <-outputs
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("child failed: %v\n%s\n%s", err, a, b)
		}
	}
	identity := func(output string) string {
		for _, line := range strings.Split(output, "\n") {
			if strings.HasPrefix(line, "CONFIG_ID=") {
				return line
			}
		}
		return ""
	}
	if identity(a) == "" || identity(a) != identity(b) {
		t.Fatalf("different process identities:\n%s\n%s", a, b)
	}
}

func TestConfigIdentityProcessChild(t *testing.T) {
	if os.Getenv("SELF_HOST_CONFIG_CHILD") != "1" {
		return
	}
	dir, candidate := os.Args[len(os.Args)-2], os.Args[len(os.Args)-1]
	data, err := system.ConfigFilesAt(dir).LoadOrCreateConfigFile("telemetry-id", func() ([]byte, error) {
		time.Sleep(50 * time.Millisecond)
		return []byte(candidate), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout.WriteString("CONFIG_ID=" + string(data))
}

func TestConfigFilePreservesSymlinkTargets(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "self-host")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "target")
	want := []byte("synthetic target must not be read or overwritten")
	if err := os.WriteFile(target, want, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "telemetry-id")); err != nil {
		t.Fatal(err)
	}
	_, err := system.ConfigFilesAt(dir).LoadOrCreateConfigFile("telemetry-id", func() ([]byte, error) {
		t.Fatal("symlink was treated as absent")
		return nil, nil
	})
	if err == nil {
		t.Fatal("symlink did not fail closed")
	}
	got, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("symlink target changed: %q, %v", got, err)
	}
}

func TestConfigFileFailedInitializationLeavesNoPartialIdentity(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "self-host")
	failure := errors.New("interrupted creation")
	_, err := system.ConfigFilesAt(dir).LoadOrCreateConfigFile("telemetry-id", func() ([]byte, error) {
		return []byte("partial"), failure
	})
	if !errors.Is(err, failure) {
		t.Fatalf("error = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "telemetry-id")); !os.IsNotExist(err) {
		t.Fatalf("partial identity published: %v", err)
	}
	const id = "6f1c2b6e-9d3a-4c1e-8a57-0b9d2f4e7a10\n"
	got, err := system.ConfigFilesAt(dir).LoadOrCreateConfigFile("telemetry-id", func() ([]byte, error) { return []byte(id), nil })
	if err != nil || string(got) != id {
		t.Fatalf("retry = %q, %v", got, err)
	}
}
