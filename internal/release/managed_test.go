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
	npmBin := filepath.Join(dir, "lib", "node_modules", "@ajnart", "self-host-linux-x64", "bin", "self-host")
	if err := os.MkdirAll(filepath.Dir(npmBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(npmBin, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "bin", "self-host")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(npmBin, link); err != nil {
		t.Fatal(err)
	}

	err := Client{}.Install(context.Background(), Release{Tag: "v9.9.9"}, "linux", "amd64", link)
	if err == nil || !strings.Contains(err.Error(), "npm i -g self-host@latest") {
		t.Fatalf("want npm ownership message, got %v", err)
	}
	if got, _ := os.ReadFile(npmBin); string(got) != "old" {
		t.Fatalf("binary was modified: %q", got)
	}
	if checkSelfManaged("/usr/bin/self-host") == nil {
		t.Fatal("/usr/bin install should be refused")
	}
	if checkSelfManaged("/opt/homebrew/Caskroom/self-host/1.0.0/self-host") == nil {
		t.Fatal("Homebrew install should be refused")
	}
	if checkSelfManaged("/usr/local/bin/self-host") != nil {
		t.Fatal("/usr/local/bin install should be allowed")
	}
	t.Setenv("SELF_HOST_IMAGE", "1")
	if checkSelfManaged("/usr/local/bin/self-host") == nil {
		t.Fatal("Docker image install should be refused")
	}
	t.Setenv("SELF_HOST_IMAGE", "")
	if checkSelfManaged(filepath.Join(dir, "self-host")) != nil {
		t.Fatal("plain install should be allowed")
	}
}
