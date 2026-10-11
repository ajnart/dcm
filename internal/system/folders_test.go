package system

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestListFoldersReturnsSortedFoldersAndLinksToFolders(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"tv", "movies"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "movies"), filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "notes.txt"), filepath.Join(dir, "filelink")); err != nil {
		t.Fatal(err)
	}

	got, err := ListFolders(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"link", "movies", "tv"}; !slices.Equal(got, want) {
		t.Fatalf("ListFolders = %q, want %q", got, want)
	}
}

func TestListFoldersFailsForAMissingFolder(t *testing.T) {
	_, err := ListFolders(filepath.Join(t.TempDir(), "missing"))
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("err = %v, want not exist", err)
	}
}

func TestListFoldersFailsForAnUnreadableFolder(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "locked")
	if err := os.Mkdir(dir, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0o755) })
	if os.Geteuid() == 0 {
		t.Skip("root reads every folder")
	}
	_, err := ListFolders(dir)
	if !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("err = %v, want permission", err)
	}
}
