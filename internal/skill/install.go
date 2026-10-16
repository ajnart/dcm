package skill

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed SKILL.md
var router []byte

const (
	entryName  = "self-host"
	markerName = ".self-host-managed"
)

const (
	Written    = "written"
	UpToDate   = "up to date"
	LeftAlone  = "left alone, managed elsewhere"
	Skipped    = "skipped, agent not installed"
	Removed    = "removed"
	NotPresent = "not installed"
)

// Result is what happened at one agent skills directory.
type Result struct {
	Agent  string `json:"agent"`
	Path   string `json:"path"`
	Status string `json:"status"`
}

type target struct {
	agent  string
	home   string
	skills string
	always bool
}

func targets(home string) []target {
	list := []target{
		{"generic", filepath.Join(home, ".agents"), filepath.Join(home, ".agents", "skills"), true},
		{"claude", filepath.Join(home, ".claude"), filepath.Join(home, ".claude", "skills"), false},
		{"codex", filepath.Join(home, ".codex"), filepath.Join(home, ".codex", "skills"), false},
		{"pi", filepath.Join(home, ".pi", "agent"), filepath.Join(home, ".pi", "agent", "skills"), false},
		{"gemini", filepath.Join(home, ".gemini"), filepath.Join(home, ".gemini", "config", "skills"), false},
		{"hermes", filepath.Join(home, ".hermes"), filepath.Join(home, ".hermes", "skills"), false},
		{"opencode", filepath.Join(home, ".config", "opencode"), filepath.Join(home, ".config", "opencode", "skills"), false},
	}
	profiles, _ := filepath.Glob(filepath.Join(home, ".hermes", "profiles", "*"))
	for _, profile := range profiles {
		if info, err := os.Stat(profile); err == nil && info.IsDir() {
			list = append(list, target{"hermes", profile, filepath.Join(profile, "skills"), false})
		}
	}
	return list
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// ours reports whether dir is a real directory that self-host wrote.
func ours(dir string) (exists, managed bool) {
	info, err := os.Lstat(dir)
	if err != nil {
		return false, false
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return true, false
	}
	_, err = os.Lstat(filepath.Join(dir, markerName))
	return true, err == nil
}

// Install writes the router skill into every agent skills directory whose
// agent home exists under home, and into ~/.agents/skills always.
func Install(home string) ([]Result, error) {
	var results []Result
	var errs []error
	for _, t := range targets(home) {
		dir := filepath.Join(t.skills, entryName)
		if !t.always && !isDir(t.home) {
			results = append(results, Result{t.agent, dir, Skipped})
			continue
		}
		status, err := installOne(dir)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", dir, err))
			continue
		}
		results = append(results, Result{t.agent, dir, status})
	}
	return results, errors.Join(errs...)
}

func installOne(dir string) (string, error) {
	exists, managed := ours(dir)
	if exists && !managed {
		return LeftAlone, nil
	}
	file := filepath.Join(dir, "SKILL.md")
	if current, err := os.ReadFile(file); err == nil && managed && bytes.Equal(current, router) {
		return UpToDate, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, markerName), []byte("written by self-host skill install\n"), 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(file, router, 0o644); err != nil {
		return "", err
	}
	return Written, nil
}

// Remove deletes only the directories Install wrote.
func Remove(home string) ([]Result, error) {
	var results []Result
	var errs []error
	for _, t := range targets(home) {
		dir := filepath.Join(t.skills, entryName)
		exists, managed := ours(dir)
		switch {
		case !exists:
			results = append(results, Result{t.agent, dir, NotPresent})
		case !managed:
			results = append(results, Result{t.agent, dir, LeftAlone})
		default:
			if err := removeOurs(dir); err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", dir, err))
				continue
			}
			results = append(results, Result{t.agent, dir, Removed})
		}
	}
	return results, errors.Join(errs...)
}

func removeOurs(dir string) error {
	for _, name := range []string{"SKILL.md", markerName} {
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		return nil
	}
	return os.Remove(dir)
}

// Router returns the content written as SKILL.md.
func Router() []byte { return bytes.Clone(router) }
