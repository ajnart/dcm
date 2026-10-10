package release_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const skillSentence = "Install the self-host skill from github.com/ajnart/selfhost-skills and help me run my own movie server."

// skillTools is every program install.sh needs, linked into one directory so a
// test controls whether bunx and npx exist without touching the real PATH.
func skillTools(t *testing.T, fakes map[string]string) (path, log string) {
	t.Helper()
	dir := t.TempDir()
	for _, name := range []string{"bash", "curl", "tar", "uname", "env", "awk", "sed", "sort", "tail", "cut", "tr", "mktemp", "rm", "cp", "chmod", "mv", "mkdir", "id", "basename", "cat", "head", "grep", "sha256sum", "shasum"} {
		if real, err := exec.LookPath(name); err == nil {
			if err := os.Symlink(real, filepath.Join(dir, name)); err != nil {
				t.Fatal(err)
			}
		}
	}
	log = filepath.Join(t.TempDir(), "calls.log")
	for name, body := range fakes {
		script := "#!/bin/sh\necho \"" + name + " $*\" >> '" + log + "'\n" + body
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return dir, log
}

func answerFile(t *testing.T, text string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tty")
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func calls(t *testing.T, log string) string {
	t.Helper()
	data, err := os.ReadFile(log)
	if os.IsNotExist(err) {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func installWithSkillStep(t *testing.T, fakes map[string]string, env ...string) (out, log string) {
	t.Helper()
	path, logPath := skillTools(t, fakes)
	server := (&installFake{tag: "v1.3.0", binary: "x"}).server(t)
	out, err := runInstaller(t, server, append([]string{"HOME=" + t.TempDir(), "PATH=" + path}, env...)...)
	if err != nil {
		t.Fatalf("install failed: %v\n%s", err, out)
	}
	return out, calls(t, logPath)
}

func TestInstallScriptNeverAsksAboutTheSkillWithoutATerminal(t *testing.T) {
	out, log := installWithSkillStep(t, map[string]string{"bunx": ""})

	if strings.Contains(out, "y/n") {
		t.Errorf("prompted without a terminal:\n%s", out)
	}
	for _, want := range []string{"bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host", skillSentence} {
		if !strings.Contains(out, want) {
			t.Errorf("hint is missing %q:\n%s", want, out)
		}
	}
	if log != "" {
		t.Errorf("ran %q without being asked", log)
	}
}

func TestInstallScriptAnswerYesRunsTheSkillCommandWithBunx(t *testing.T) {
	out, log := installWithSkillStep(t, map[string]string{"bunx": "", "npx": ""}, "SELF_HOST_TTY="+answerFile(t, "y\n"))

	if !strings.Contains(out, "Add the self-host skill to your AI agent too? y/n") {
		t.Errorf("no prompt:\n%s", out)
	}
	if want := "bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host\n"; log != want {
		t.Errorf("ran %q, want %q", log, want)
	}
}

func TestInstallScriptAnswerYesFallsBackToNpx(t *testing.T) {
	_, log := installWithSkillStep(t, map[string]string{"npx": ""}, "SELF_HOST_TTY="+answerFile(t, "y\n"))

	if want := "npx --yes skills add ajnart/selfhost-skills --skill self-host\n"; log != want {
		t.Errorf("ran %q, want %q", log, want)
	}
}

func TestInstallScriptAnswerYesUsesTheReleaseRepoOverride(t *testing.T) {
	_, log := installWithSkillStep(t, map[string]string{"bunx": ""}, "SELF_HOST_TTY="+answerFile(t, "y\n"), "SELF_HOST_RELEASE_REPO=someone/fork")

	if want := "bunx --bun skills@latest add someone/fork --skill self-host\n"; log != want {
		t.Errorf("ran %q, want %q", log, want)
	}
}

func TestInstallScriptAnswerYesWithoutBunxOrNpxPrintsTheHint(t *testing.T) {
	out, log := installWithSkillStep(t, nil, "SELF_HOST_TTY="+answerFile(t, "y\n"))

	for _, want := range []string{"bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host", skillSentence} {
		if !strings.Contains(out, want) {
			t.Errorf("hint is missing %q:\n%s", want, out)
		}
	}
	if log != "" {
		t.Errorf("ran %q", log)
	}
}

func TestInstallScriptAnswerNoPrintsTheHintAndRunsNothing(t *testing.T) {
	for _, answer := range []string{"n\n", "\n", ""} {
		out, log := installWithSkillStep(t, map[string]string{"bunx": ""}, "SELF_HOST_TTY="+answerFile(t, answer))

		if !strings.Contains(out, skillSentence) {
			t.Errorf("answer %q: no hint:\n%s", answer, out)
		}
		if log != "" {
			t.Errorf("answer %q: ran %q", answer, log)
		}
	}
}

func TestInstallScriptSkipVariableSkipsThePrompt(t *testing.T) {
	out, log := installWithSkillStep(t, map[string]string{"bunx": ""}, "SELF_HOST_TTY="+answerFile(t, "y\n"), "SELF_HOST_SKIP_SKILL_PROMPT=1")

	if strings.Contains(out, "y/n") {
		t.Errorf("prompted despite SELF_HOST_SKIP_SKILL_PROMPT=1:\n%s", out)
	}
	if log != "" {
		t.Errorf("ran %q", log)
	}
}

func TestInstallScriptSurvivesAFailingSkillCommand(t *testing.T) {
	out, _ := installWithSkillStep(t, map[string]string{"bunx": "exit 3\n"}, "SELF_HOST_TTY="+answerFile(t, "y\n"))

	if !strings.Contains(out, skillSentence) {
		t.Errorf("no hint after the skill command failed:\n%s", out)
	}
}
