package cli_test

import (
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/systemtest"
)

const noticeLine = "self-host 1.2.0 is available: run self-host self-update"

func noticeSetup(t *testing.T, version string, interactive bool, env map[string]string) (*fakeRelease, func(args ...string) clitest.Result, func()) {
	t.Helper()
	rel := &fakeRelease{tag: "v1.2.0", binary: "new-binary"}
	deps, _ := updateDeps(t, version, rel.server(t, "linux", "amd64"))
	deps.Interactive = interactive
	systemtest.SetEnv(deps, map[string]string{
		"SELF_HOST_RELEASES_URL": deps.Getenv("SELF_HOST_RELEASES_URL"),
		"SELF_HOST_WEB_URL":      deps.Getenv("SELF_HOST_WEB_URL"),
	})
	for k, v := range env {
		systemtest.SetEnv(deps, map[string]string{k: v})
	}
	run := func(args ...string) clitest.Result {
		return clitest.Run(t, deps, catalog.Default(), args...)
	}
	return rel, run, func() { deps.Sleep(t.Context(), 25*time.Hour) }
}

func TestAPlainCommandOnATerminalNamesANewerReleaseAfterItsOutput(t *testing.T) {
	_, run, _ := noticeSetup(t, "1.0.0", true, nil)

	r := run("apps", "list")

	if r.Code != 0 || !strings.HasSuffix(strings.TrimSpace(r.Out), noticeLine) {
		t.Fatalf("exit %d; the notice should end the output:\n%s", r.Code, r.Out)
	}
}

func TestTheNoticeIsAtMostOncePerDayAndTheLookupIsCached(t *testing.T) {
	rel, run, nextDay := noticeSetup(t, "1.0.0", true, nil)
	run("apps", "list")

	again := run("apps", "list")

	if strings.Contains(again.Out, noticeLine) || rel.apiCalls != 1 {
		t.Fatalf("second run within 24 h: %d lookups\n%s", rel.apiCalls, again.Out)
	}
	nextDay()
	if next := run("apps", "list"); !strings.Contains(next.Out, noticeLine) || rel.apiCalls != 2 {
		t.Fatalf("after 24 h: %d lookups\n%s", rel.apiCalls, next.Out)
	}
}

func TestTheNoticeIsSilentWhenUpToDate(t *testing.T) {
	_, run, _ := noticeSetup(t, "1.2.0", true, nil)

	if r := run("apps", "list"); strings.Contains(r.Out, "is available") {
		t.Fatalf("unexpected notice:\n%s", r.Out)
	}
}

func TestTheNoticeObeysEverySuppressionRule(t *testing.T) {
	for _, tc := range []struct {
		name        string
		version     string
		interactive bool
		env         map[string]string
		args        []string
	}{
		{"json output", "1.0.0", true, nil, []string{"apps", "list", "--json"}},
		{"not a terminal", "1.0.0", false, nil, []string{"apps", "list"}},
		{"continuous integration", "1.0.0", true, map[string]string{"CI": "true"}, []string{"apps", "list"}},
		{"development build", "dev", true, nil, []string{"apps", "list"}},
		{"opted out", "1.0.0", true, map[string]string{"SELF_HOST_NO_UPDATE_CHECK": "1"}, []string{"apps", "list"}},
		{"the self-update command", "1.2.0", true, nil, []string{"self-update"}},
		{"a failing command", "1.0.0", true, nil, []string{"nope"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rel, run, _ := noticeSetup(t, tc.version, tc.interactive, tc.env)

			r := run(tc.args...)

			if strings.Contains(r.Out, "is available") {
				t.Errorf("unexpected notice:\n%s", r.Out)
			}
			if tc.args[0] != "self-update" && rel.apiCalls != 0 {
				t.Errorf("the release lookup ran %d times", rel.apiCalls)
			}
		})
	}
}
