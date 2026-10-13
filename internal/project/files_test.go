package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveAppDirRefusesProjectAndFolderRoots(t *testing.T) {
	p := &Project{Root: t.TempDir()}
	app := p.Path("apps", "demo")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{p.Root, p.Path("apps"), filepath.Join(p.Root, "..", "outside")} {
		if err := p.RemoveAppDir(dir); err == nil {
			t.Fatalf("RemoveAppDir(%q) succeeded", dir)
		}
	}
	if _, err := os.Stat(app); err != nil {
		t.Fatalf("app folder removed: %v", err)
	}
	if err := p.RemoveAppDir(app); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(app); !os.IsNotExist(err) {
		t.Fatalf("app folder still present: %v", err)
	}
}
