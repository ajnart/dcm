package system

import (
	"os"
	"path/filepath"
	"sort"

	"golang.org/x/sys/unix"
)

// ListFolders returns the names of the folders inside dir, following links to
// folders and leaving out files, sorted by name.
func ListFolders(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
			continue
		}
		if entry.Type()&os.ModeSymlink == 0 {
			continue
		}
		if info, err := os.Stat(filepath.Join(dir, entry.Name())); err == nil && info.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// DiskFree reports the available bytes on the filesystem that will contain
// path. It walks to an existing parent so a new Home folder can be checked
// before Onboarding creates it.
func DiskFree(path string) (uint64, error) {
	for {
		if _, err := os.Stat(path); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return 0, err
		}
		parent := filepath.Dir(path)
		if parent == path {
			break
		}
		path = parent
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil
}
