package cli_test

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/cli"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/systemtest"
)

func guideOutput(t *testing.T) string {
	t.Helper()
	deps := systemtest.NewDeps(t)
	deps.Version = "1.4.0"
	res := clitest.Run(t, deps, catalog.Default(), "skill")
	if res.Code != cli.ExitOK {
		t.Fatalf("self-host skill exited %d:\n%s", res.Code, res.Out)
	}
	return res.Out
}

func walk(cmd *cobra.Command, visit func(*cobra.Command)) {
	visit(cmd)
	for _, sub := range cmd.Commands() {
		walk(sub, visit)
	}
}

func TestSkillGuideNamesEveryRegisteredCommandAndFlag(t *testing.T) {
	guide := guideOutput(t)
	root := cli.NewRootCommand(systemtest.NewDeps(t), catalog.Default())

	walk(root, func(cmd *cobra.Command) {
		if cmd.Hidden || cmd.Name() == "help" || cmd.Name() == "completion" {
			return
		}
		if cmd != root && !cmd.HasSubCommands() {
			if want := "self-host " + strings.TrimPrefix(cmd.CommandPath(), root.Name()+" "); !strings.Contains(guide, want) {
				t.Errorf("guide never mentions command %q", want)
			}
		}
		cmd.NonInheritedFlags().VisitAll(func(f *pflag.Flag) {
			if f.Name == "help" || f.Hidden {
				return
			}
			if !strings.Contains(guide, "--"+f.Name) {
				t.Errorf("guide never mentions flag --%s of %q", f.Name, cmd.CommandPath())
			}
		})
	})
	root.PersistentFlags().VisitAll(func(f *pflag.Flag) {
		if !strings.Contains(guide, "--"+f.Name) {
			t.Errorf("guide never mentions global flag --%s", f.Name)
		}
	})
}

func TestSkillGuideDistinguishesDockerSocketFailures(t *testing.T) {
	guide := guideOutput(t)
	for _, want := range []string{
		"check's `msg`, `hint` and `docs`",
		"For example,",
		"the engine may be stopped or socket permission may be denied",
	} {
		if !strings.Contains(guide, want) {
			t.Errorf("guide does not distinguish Docker socket failures: missing %q", want)
		}
	}
	if strings.Contains(guide, "check's `detail`") {
		t.Error("guide exposes the internal check detail field instead of the public msg field")
	}
}

// commandsTable returns the command path (without "self-host") of every row
// in the guide's Commands table; the bare command is the empty path.
func commandsTable(guide string) []string {
	section := guide[strings.Index(guide, "## Commands"):]
	if next := strings.Index(section[len("## Commands"):], "\n## "); next >= 0 {
		section = section[:len("## Commands")+next]
	}
	var paths []string
	for _, line := range strings.Split(section, "\n") {
		if !strings.HasPrefix(line, "| `self-host") {
			continue
		}
		span := strings.SplitN(strings.TrimPrefix(line, "| `"), "`", 2)[0]
		var words []string
		for _, word := range strings.Fields(span)[1:] {
			if !regexp.MustCompile(`^[a-z][a-z-]*$`).MatchString(word) {
				break
			}
			words = append(words, word)
		}
		paths = append(paths, strings.Join(words, " "))
	}
	return paths
}

func registeredCommandPaths(root *cobra.Command) []string {
	var paths []string
	walk(root, func(cmd *cobra.Command) {
		if cmd.Hidden || cmd.Name() == "help" || cmd.Name() == "completion" || (cmd != root && cmd.HasSubCommands()) {
			return
		}
		paths = append(paths, strings.TrimSpace(strings.TrimPrefix(cmd.CommandPath(), root.Name())))
	})
	return paths
}

func TestSkillGuideCommandsTableListsEveryRegisteredCommand(t *testing.T) {
	guide := guideOutput(t)
	root := cli.NewRootCommand(systemtest.NewDeps(t), catalog.Default())

	documented, registered := commandsTable(guide), registeredCommandPaths(root)

	if !sortedEqual(documented, registered) {
		t.Errorf("Commands table lists %q, the binary registers %q", documented, registered)
	}
}

// unknownMentions returns every `self-host a b` code span in guide whose
// leading words are not a registered command path (so `self-host apps lst`
// fails), and every --flag token that no registered command defines.
func unknownMentions(root *cobra.Command, guide string) []string {
	var bad []string
	for _, span := range regexp.MustCompile("`(self-host(?: [^`]*)?)`").FindAllStringSubmatch(guide, -1) {
		var words []string
		for _, word := range strings.Fields(span[1])[1:] {
			if !regexp.MustCompile(`^[a-z][a-z-]*$`).MatchString(word) {
				break
			}
			words = append(words, word)
		}
		cmd, rest, err := root.Find(words)
		// Positional arguments may follow a leaf command, never a command group.
		if err != nil || (len(rest) > 0 && cmd.HasSubCommands()) {
			bad = append(bad, span[1])
		}
	}

	known := map[string]bool{"help": true}
	walk(root, func(cmd *cobra.Command) {
		cmd.LocalFlags().VisitAll(func(f *pflag.Flag) { known[f.Name] = true })
		cmd.PersistentFlags().VisitAll(func(f *pflag.Flag) { known[f.Name] = true })
	})
	for _, flag := range regexp.MustCompile(`--[a-z][a-z-]*`).FindAllString(guide, -1) {
		if !known[strings.TrimPrefix(flag, "--")] {
			bad = append(bad, flag)
		}
	}
	return bad
}

func TestSkillGuideMentionsOnlyRegisteredCommandsAndFlags(t *testing.T) {
	guide := guideOutput(t)
	root := cli.NewRootCommand(systemtest.NewDeps(t), catalog.Default())

	if !strings.Contains(guide, "`self-host apps list") {
		t.Fatal("guide has no `self-host <command>` examples")
	}
	for _, mention := range unknownMentions(root, guide) {
		t.Errorf("guide mentions %q, which the binary does not register", mention)
	}
}

func TestUnknownMentionsCatchesTyposAndMissingFlags(t *testing.T) {
	root := cli.NewRootCommand(systemtest.NewDeps(t), catalog.Default())
	guide := "Run `self-host apps lst` or `self-host instal media --yes` or `self-host status --verbosity`. " +
		"Fine: `self-host apps list`, `self-host install media --set a=b`, `self-host`."

	got := unknownMentions(root, guide)

	want := []string{"self-host apps lst", "self-host instal media --yes", "--verbosity"}
	if len(got) != len(want) {
		t.Fatalf("flagged %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("flagged %q, want %q", got[i], want[i])
		}
	}
}

// tableFirstColumn returns the backticked names in the first column of every
// table row between the heading and the next heading.
func tableFirstColumn(guide, heading string) []string {
	section := guide[strings.Index(guide, heading):]
	if next := strings.Index(section[len(heading):], "\n## "); next >= 0 {
		section = section[:len(heading)+next]
	}
	var names []string
	for _, line := range strings.Split(section, "\n") {
		if !strings.HasPrefix(line, "| `") {
			continue
		}
		first := strings.SplitN(line, "|", 3)[1]
		for _, m := range regexp.MustCompile("`([^`]+)`").FindAllStringSubmatch(first, -1) {
			names = append(names, m[1])
		}
	}
	return names
}

func sortedEqual(got, want []string) bool {
	got, want = slices.Sorted(slices.Values(got)), slices.Sorted(slices.Values(want))
	return slices.Equal(got, want)
}

func TestSkillGuideEventFieldsMatchTheEventStruct(t *testing.T) {
	guide := guideOutput(t)
	var fields []string
	for i := 0; i < reflect.TypeFor[events.Event]().NumField(); i++ {
		name, _, _ := strings.Cut(reflect.TypeFor[events.Event]().Field(i).Tag.Get("json"), ",")
		fields = append(fields, name)
	}

	documented := tableFirstColumn(guide, "## JSON events")

	if !sortedEqual(documented, fields) {
		t.Errorf("guide documents event fields %v, events.Event has %v", documented, fields)
	}
}

func TestSkillGuideListsEveryEventName(t *testing.T) {
	guide := guideOutput(t)
	for _, name := range []string{events.RunStart, events.RunEnd, events.StepStart, events.StepOK, events.StepSkip,
		events.StepWarn, events.StepFail, events.Command, events.Info} {
		if !strings.Contains(guide, "`"+name+"`") {
			t.Errorf("guide does not list event %q", name)
		}
	}
}

func TestSkillGuideExitCodesMatchTheConstants(t *testing.T) {
	guide := guideOutput(t)
	section := guide[strings.Index(guide, "## Exit codes"):]
	section = section[:strings.Index(section[3:], "\n## ")+3]
	var documented []string
	for _, m := range regexp.MustCompile("(?m)^- `(\\d+)`").FindAllStringSubmatch(section, -1) {
		documented = append(documented, m[1])
	}

	want := []string{strconv.Itoa(cli.ExitOK), strconv.Itoa(cli.ExitError), strconv.Itoa(cli.ExitIncomplete), strconv.Itoa(cli.ExitManual)}

	if !sortedEqual(documented, want) {
		t.Errorf("guide documents exit codes %v, the binary uses %v", documented, want)
	}
}

func TestSkillGuideMatchesTheBinaryVersion(t *testing.T) {
	if guide := guideOutput(t); !strings.Contains(guide, "1.4.0") {
		t.Errorf("guide does not name the binary version:\n%s", guide[:200])
	}
}

func openingSection(t *testing.T, guide string) string {
	t.Helper()
	start := strings.Index(guide, "## Every conversation")
	end := strings.Index(guide, "## Setting up")
	if start < 0 || end < start {
		t.Fatalf("guide has no \"## Every conversation\" section before \"## Setting up\":\n%.300s", guide)
	}
	return strings.Join(strings.Fields(guide[start:end]), " ")
}

func TestSkillGuideOpensWithTheRoutineEveryConversationFollows(t *testing.T) {
	opening := openingSection(t, guideOutput(t))

	wants := []string{
		"`self-host status --json`",
		"`self-host profile --json`",
		"Have you run your own server or used Docker before, or is this all new to you?",
		"`self-host profile set experience new`",
		"`self-host profile set experience advanced`",
		"one plain sentence",
		"Never ask for or show a secret",
		"`self-host doctor",
		"the engine that runs your apps",
		"agent-browser",
		"`self-host debug <app> --json`",
		"The Recap",
		"`description`",
		"`home`",
		"`self-host credentials`",
		"Want your own web address?",
	}
	rest := opening
	for _, want := range wants {
		at := strings.Index(rest, want)
		if at < 0 {
			t.Errorf("opening section never says %q after the previous item", want)
			continue
		}
		rest = rest[at+len(want):]
	}
}

func readSkillFile(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "skills", "self-host", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestSkillFileLoadsOnItsOwnAndStaysWithinTheIdleBudget(t *testing.T) {
	skillFile := readSkillFile(t)

	for _, explicitOnly := range []string{"disable-model-invocation", "allow_implicit_invocation"} {
		if strings.Contains(skillFile, explicitOnly) {
			t.Errorf("SKILL.md is explicit-only: it mentions %q", explicitOnly)
		}
	}
	for _, want := range []string{"`self-host skill`", "self-host.fyi/install"} {
		if !strings.Contains(skillFile, want) {
			t.Errorf("SKILL.md never mentions %q", want)
		}
	}
	if tokens := utf8.RuneCountInString(skillFile) / 4; tokens > 200 {
		t.Errorf("SKILL.md costs about %d tokens while idle, want 200 or fewer", tokens)
	}
}

func TestSkillInstallAndRemoveReportEveryPathAsJSON(t *testing.T) {
	deps := systemtest.NewDeps(t)
	owner, _ := deps.CurrentUser()
	if err := os.MkdirAll(filepath.Join(owner.Home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}

	res := clitest.Run(t, deps, catalog.Default(), "skill", "install", "--json")
	if res.Code != cli.ExitOK {
		t.Fatalf("exit %d:\n%s", res.Code, res.Out)
	}
	for _, want := range []string{`"status": "written"`, `"status": "skipped, agent not installed"`, ".claude/skills/self-host"} {
		if !strings.Contains(res.Out, want) {
			t.Errorf("install output missing %q:\n%s", want, res.Out)
		}
	}

	res = clitest.Run(t, deps, catalog.Default(), "skill", "remove")
	if res.Code != cli.ExitOK || !strings.Contains(res.Out, "removed") {
		t.Errorf("remove: exit %d:\n%s", res.Code, res.Out)
	}
}
