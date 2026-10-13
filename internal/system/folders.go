package system

import (
	"os"
	"path/filepath"
	"sort"
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
