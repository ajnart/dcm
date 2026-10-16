package release

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelfUpdateRefusesInstallsAPackageManagerOwns(t *testing.T) {
	dir := t.TempDir()
	caskBin := filepath.Join(dir, "Caskroom", "self-host", "1.0.0", "self-host")
	if err := os.MkdirAll(filepath.Dir(caskBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(caskBin, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "bin", "self-host")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(caskBin, link); err != nil {
		t.Fatal(err)
	}

	err := Client{}.Install(context.Background(), Release{Tag: "v9.9.9"}, "linux", "amd64", link)
	if err == nil || !strings.Contains(err.Error(), "brew upgrade self-host") {
		t.Fatalf("want Homebrew ownership message, got %v", err)
	}
	if got, _ := os.ReadFile(caskBin); string(got) != "old" {
		t.Fatalf("binary was modified: %q", got)
	}
	if CheckSelfManaged("/usr/bin/self-host") == nil {
		t.Fatal("/usr/bin install should be refused")
	}
	if CheckSelfManaged("/usr/local/bin/self-host") != nil {
		t.Fatal("/usr/local/bin install should be allowed")
	}
	t.Setenv("SELF_HOST_IMAGE", "1")
	if CheckSelfManaged("/usr/local/bin/self-host") == nil {
		t.Fatal("Docker image install should be refused")
	}
	t.Setenv("SELF_HOST_IMAGE", "")
	if CheckSelfManaged(filepath.Join(dir, "self-host")) != nil {
		t.Fatal("plain install should be allowed")
	}
}
