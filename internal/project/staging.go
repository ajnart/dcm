package project

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Staging is a scratch directory inside the Project where a Restore unpacks a
// Backup, parks the data it replaces and keeps the original records, so a
// failed Restore can put everything back.
type Staging struct {
	root    string
	folder  func(id string) string
	changed []*swap
}

type swap struct {
	id             string
	old, installed bool
}

// NewStaging creates an empty staging directory. folder names the Project
// folder, apps or extra, that holds each App.
func (p *Project) NewStaging(folder func(id string) string) (*Staging, error) {
	root, err := os.MkdirTemp(p.Root, ".restore-")
	if err != nil {
		return nil, err
	}
	return &Staging{root: root, folder: folder}, nil
}

func (s *Staging) Dir() string { return s.root }

func (s *Staging) Path(parts ...string) string {
	return filepath.Join(append([]string{s.root}, parts...)...)
}

// Records is a read-only view of the settings, secrets and state unpacked
// into the staging directory.
func (s *Staging) Records() *Project { return &Project{Root: s.root} }

// AppDir is where an App's unpacked folder waits to be installed.
func (s *Staging) AppDir(id string) string { return s.Path(s.folder(id), id) }

// ReplacedDir is where an App's current folder is parked while its
// replacement is installed.
func (s *Staging) ReplacedDir(id string) string { return s.Path("replaced-" + id) }

func (s *Staging) FragmentPath(id string) string { return filepath.Join(s.AppDir(id), "compose.yml") }

func (s *Staging) ReadFragment(id string) ([]byte, error) { return os.ReadFile(s.FragmentPath(id)) }

// FragmentServices lists the Compose services an unpacked App declares.
func (s *Staging) FragmentServices(id string) ([]string, error) {
	return fragmentServices(s.FragmentPath(id))
}

// SaveOriginalRecords keeps the Project's current records so Rollback can be
// diagnosed and recovered from even if the process dies.
func (s *Staging) SaveOriginalRecords(secrets map[string]string, state *State, settings map[string]string) error {
	original := &Project{Root: s.Path("original-records")}
	if err := original.SaveSecrets(secrets); err != nil {
		return err
	}
	if err := original.SaveState(state); err != nil {
		return err
	}
	return original.SaveSettings(settings)
}

// ExtractChown returns the owner callback for extracting into the staging
// directory: nil unless running as root, and it leaves the files of Apps
// where skip is true for their own helper to own.
func (s *Staging) ExtractChown(skip func(id string) bool) func(string, int, int) error {
	if os.Geteuid() != 0 {
		return nil
	}
	return func(path string, uid, gid int) error {
		rel, err := filepath.Rel(s.root, path)
		if err != nil {
			return err
		}
		parts := strings.SplitN(rel, string(filepath.Separator), 3)
		if len(parts) > 1 && (parts[0] == "apps" || parts[0] == ExtraDirName) && skip(parts[1]) {
			return nil
		}
		return os.Lchown(path, uid, gid)
	}
}

// Replace parks the App's current folder in the staging directory, if there
// is one, and moves the unpacked folder into its place.
func (s *Staging) Replace(p *Project, id string) error {
	folder := s.folder(id)
	item := &swap{id: id}
	s.changed = append(s.changed, item)
	if err := os.Rename(p.Path(folder, id), s.ReplacedDir(id)); err != nil {
		if !os.IsNotExist(err) {
			return err
		}
	} else {
		item.old = true
	}
	if err := p.MkdirAll(folder); err != nil {
		return err
	}
	if err := os.Rename(s.AppDir(id), p.Path(folder, id)); err != nil {
		return err
	}
	item.installed = true
	return nil
}

// Rollback undoes every Replace, newest first: removeInstalled deletes the
// replacement folder, then the parked folder returns.
func (s *Staging) Rollback(p *Project, removeInstalled func(id, dir string) error) error {
	var errs []error
	for i := len(s.changed) - 1; i >= 0; i-- {
		item := s.changed[i]
		dir := p.Path(s.folder(item.id), item.id)
		if item.installed {
			if err := removeInstalled(item.id, dir); err != nil {
				errs = append(errs, err)
				continue
			}
		}
		if item.old {
			if err := os.Rename(s.ReplacedDir(item.id), dir); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

// Remove deletes the staging directory.
func (s *Staging) Remove() error { return os.RemoveAll(s.root) }
