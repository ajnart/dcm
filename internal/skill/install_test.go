package skill_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ajnart/self-host/internal/skill"
)

func statuses(results []skill.Result) map[string]string {
	got := map[string]string{}
	for _, r := range results {
		got[r.Path] = r.Status
	}
	return got
}

func mkdir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestRouterMatchesThePublicSkillFile(t *testing.T) {
	public, err := os.ReadFile(filepath.Join("..", "..", "skills", "self-host", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(public) != string(skill.Router()) {
		t.Error("internal/skill/SKILL.md differs from skills/self-host/SKILL.md; copy one over the other")
	}
}

func TestInstallWritesOnlyWhereAnAgentLives(t *testing.T) {
	home := t.TempDir()
	mkdir(t, filepath.Join(home, ".claude"))
	mkdir(t, filepath.Join(home, ".config", "opencode"))
	mkdir(t, filepath.Join(home, ".hermes", "profiles", "work"))

	results, err := skill.Install(home)
	if err != nil {
		t.Fatal(err)
	}

	got := statuses(results)
	for path, want := range map[string]string{
		filepath.Join(home, ".agents", "skills", "self-host"):                     skill.Written,
		filepath.Join(home, ".claude", "skills", "self-host"):                     skill.Written,
		filepath.Join(home, ".config", "opencode", "skills", "self-host"):         skill.Written,
		filepath.Join(home, ".hermes", "skills", "self-host"):                     skill.Written,
		filepath.Join(home, ".hermes", "profiles", "work", "skills", "self-host"): skill.Written,
		filepath.Join(home, ".codex", "skills", "self-host"):                      skill.Skipped,
		filepath.Join(home, ".gemini", "config", "skills", "self-host"):           skill.Skipped,
		filepath.Join(home, ".pi", "agent", "skills", "self-host"):                skill.Skipped,
	} {
		if got[path] != want {
			t.Errorf("%s: %q, want %q", path, got[path], want)
		}
	}
	data, err := os.ReadFile(filepath.Join(home, ".claude", "skills", "self-host", "SKILL.md"))
	if err != nil || string(data) != string(skill.Router()) {
		t.Errorf("SKILL.md content wrong: %v", err)
	}
	for _, absent := range []string{".codex", ".gemini", ".pi"} {
		if _, err := os.Stat(filepath.Join(home, absent)); err == nil {
			t.Errorf("created agent home %s", absent)
		}
	}
}

func TestInstallIsIdempotentAndRepairsStaleContent(t *testing.T) {
	home := t.TempDir()
	if _, err := skill.Install(home); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(home, ".agents", "skills", "self-host")

	results, _ := skill.Install(home)
	if got := statuses(results)[dir]; got != skill.UpToDate {
		t.Errorf("second run: %q", got)
	}

	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	results, _ = skill.Install(home)
	if got := statuses(results)[dir]; got != skill.Written {
		t.Errorf("stale content: %q", got)
	}
}

func TestInstallLeavesForeignEntriesAlone(t *testing.T) {
	home := t.TempDir()
	mkdir(t, filepath.Join(home, ".claude"))
	foreignDir := filepath.Join(home, ".agents", "skills", "self-host")
	mkdir(t, foreignDir)
	if err := os.WriteFile(filepath.Join(foreignDir, "SKILL.md"), []byte("theirs"), 0o644); err != nil {
		t.Fatal(err)
	}
	elsewhere := t.TempDir()
	mkdir(t, filepath.Join(home, ".claude", "skills"))
	link := filepath.Join(home, ".claude", "skills", "self-host")
	if err := os.Symlink(elsewhere, link); err != nil {
		t.Fatal(err)
	}

	results, err := skill.Install(home)
	if err != nil {
		t.Fatal(err)
	}

	got := statuses(results)
	if got[foreignDir] != skill.LeftAlone || got[link] != skill.LeftAlone {
		t.Errorf("statuses %v", got)
	}
	if data, _ := os.ReadFile(filepath.Join(foreignDir, "SKILL.md")); string(data) != "theirs" {
		t.Errorf("foreign skill rewritten: %q", data)
	}
	if entries, _ := os.ReadDir(elsewhere); len(entries) != 0 {
		t.Error("wrote through the symlink")
	}

	results, _ = skill.Remove(home)
	if got := statuses(results); got[foreignDir] != skill.LeftAlone || got[link] != skill.LeftAlone {
		t.Errorf("remove statuses %v", got)
	}
	if _, err := os.Stat(filepath.Join(foreignDir, "SKILL.md")); err != nil {
		t.Error("remove deleted a foreign skill")
	}
}

func TestRemoveDeletesOnlyWhatInstallWrote(t *testing.T) {
	home := t.TempDir()
	mkdir(t, filepath.Join(home, ".codex"))
	if _, err := skill.Install(home); err != nil {
		t.Fatal(err)
	}

	results, err := skill.Remove(home)
	if err != nil {
		t.Fatal(err)
	}

	got := statuses(results)
	if got[filepath.Join(home, ".codex", "skills", "self-host")] != skill.Removed {
		t.Errorf("statuses %v", got)
	}
	if got[filepath.Join(home, ".claude", "skills", "self-host")] != skill.NotPresent {
		t.Errorf("statuses %v", got)
	}
	if _, err := os.Stat(filepath.Join(home, ".agents", "skills", "self-host")); err == nil {
		t.Error("entry still present")
	}
}
