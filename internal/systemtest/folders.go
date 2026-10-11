package systemtest

import (
	"io/fs"
	"sync"
)

// Folders is a scripted file system for ListFolders: the folders inside each
// directory, and the directories that cannot be read.
type Folders struct {
	mu     sync.Mutex
	tree   map[string][]string
	denied map[string]bool
	calls  []string
}

// Add lists names as the folders inside dir.
func (f *Folders) Add(dir string, names ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.tree == nil {
		f.tree = map[string][]string{}
	}
	f.tree[dir] = append(f.tree[dir], names...)
}

// Deny makes dir fail with a permission error.
func (f *Folders) Deny(dir string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.denied == nil {
		f.denied = map[string]bool{}
	}
	f.denied[dir] = true
}

// List is system.Deps.ListFolders.
func (f *Folders) List(dir string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, dir)
	if f.denied[dir] {
		return nil, &fs.PathError{Op: "open", Path: dir, Err: fs.ErrPermission}
	}
	names, ok := f.tree[dir]
	if !ok {
		return nil, &fs.PathError{Op: "open", Path: dir, Err: fs.ErrNotExist}
	}
	return append([]string(nil), names...), nil
}

// Calls returns every directory listed so far.
func (f *Folders) Calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}
