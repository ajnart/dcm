package cli_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestStatusJSONRedactsLegacyStepDiagnostics(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json"); code != 0 {
		t.Fatalf("install: exit %d\n%s", code, out)
	}
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	if err := p.SaveSecrets(map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "synthetic-password"}); err != nil {
		t.Fatal(err)
	}
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	state.Apps["one"].Steps["configure"] = project.StepRecord{Status: "fail", Msg: "failed synthetic-password", Error: "refused synthetic-password", Hint: "retry synthetic-password"}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "status", "--json")
	if code != 0 || strings.Contains(out, "synthetic-password") {
		t.Fatalf("legacy status diagnostic leaked credential: exit %d\n%s", code, out)
	}
	for _, detail := range []string{"failed [redacted]", "refused [redacted]", "retry [redacted]"} {
		if !strings.Contains(out, detail) {
			t.Fatalf("status lost useful detail %q\n%s", detail, out)
		}
	}
}
