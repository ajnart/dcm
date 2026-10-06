package cli_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/cli"
	"github.com/ajnart/self-host/internal/clitest"
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

func TestSkillGuideMentionsOnlyRegisteredCommands(t *testing.T) {
	guide := guideOutput(t)
	root := cli.NewRootCommand(systemtest.NewDeps(t), catalog.Default())
	registered := map[string]bool{}
	for _, cmd := range root.Commands() {
		registered[cmd.Name()] = true
	}

	mentions := regexp.MustCompile("`self-host ([a-z][a-z-]*)").FindAllStringSubmatch(guide, -1)
	if len(mentions) == 0 {
		t.Fatal("guide has no `self-host <command>` examples")
	}
	for _, m := range mentions {
		if !registered[m[1]] {
			t.Errorf("guide mentions unknown command `self-host %s`", m[1])
		}
	}
}

func TestSkillGuideMatchesTheBinaryVersion(t *testing.T) {
	if guide := guideOutput(t); !strings.Contains(guide, "1.4.0") {
		t.Errorf("guide does not name the binary version:\n%s", guide[:200])
	}
}
