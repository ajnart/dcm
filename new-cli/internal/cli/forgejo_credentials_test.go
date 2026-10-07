package cli_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestForgejoAliasIsVisibleInCredentialsAndDiagnostics(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "forgejo", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, "install", "forgejo", "--yes", "--json"); code != 0 {
		t.Fatalf("install: exit %d\n%s", code, out)
	}
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	if err := p.SaveSecrets(map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "synthetic-password", "FORGEJO_ADMIN_USER": "selfhost-admin"}); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "credentials")
	if code != 0 || !strings.Contains(out, "Shared Admin login") || !strings.Contains(out, "FORGEJO_ADMIN_USER  selfhost-admin") || strings.Contains(out, "Admin login (every App)") {
		t.Fatalf("credentials do not distinguish the shared login from Forgejo's alias: exit %d\n%s", code, out)
	}
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	state.Apps["forgejo"].Steps["configure"] = project.StepRecord{Status: "fail", Msg: "create selfhost-admin", Error: "refused synthetic-password", Hint: "sign in as selfhost-admin"}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	code, out = runWith(t, deps, cat, "status", "--json")
	if code != 0 || !strings.Contains(out, "sign in as selfhost-admin") || strings.Contains(out, "synthetic-password") {
		t.Fatalf("username hidden or password leaked in diagnostics: exit %d\n%s", code, out)
	}
}
