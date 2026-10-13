package project

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"go.yaml.in/yaml/v3"
)

func (p *Project) ReadFragment(id string) ([]byte, error) { return os.ReadFile(p.FragmentPath(id)) }

// FragmentServices lists the Compose services an App's fragment declares.
func (p *Project) FragmentServices(id string) ([]string, error) {
	return fragmentServices(p.FragmentPath(id))
}

func fragmentServices(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Services map[string]any `yaml:"services"`
	}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	names := make([]string, 0, len(doc.Services))
	for name := range doc.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

// RemoveFragment deletes an App's Compose fragment.
func (p *Project) RemoveFragment(id string) error { return os.Remove(p.FragmentPath(id)) }

// RemoveAppDir deletes an App's folder and everything in it.
func (p *Project) RemoveAppDir(dir string) error {
	rel, err := filepath.Rel(p.Root, dir)
	if err != nil || !filepath.IsLocal(rel) || filepath.Dir(rel) == "." {
		return errors.New("App folder must stay inside its Project")
	}
	return os.RemoveAll(dir)
}

// HasAppFile reports whether a file exists at rel inside apps/<id>.
func (p *Project) HasAppFile(id, rel string) bool {
	_, err := os.Stat(p.Path("apps", id, rel))
	return err == nil
}

// ReadNamesCaddyfile reads the Caddyfile of the Caddy for Easy names.
func (p *Project) ReadNamesCaddyfile() ([]byte, error) { return os.ReadFile(p.NamesCaddyfilePath()) }

// MkdirAllOwned creates a folder outside the Project, such as the media
// folder, handing it to the Project owner when run as root.
func (p *Project) MkdirAllOwned(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if os.Geteuid() == 0 {
		os.Chown(dir, p.Owner.UID, p.Owner.GID)
	}
	return nil
}
