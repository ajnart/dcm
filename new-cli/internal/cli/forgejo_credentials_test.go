package cli_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// savedForgejoAlias installs one App and saves the reserved-username alias the
// way Forgejo's Setup does.
func savedForgejoAlias(t *testing.T) *system.Deps {
	t.Helper()
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
	return deps
}

func TestForgejoAliasIsNamedInCredentialsJSON(t *testing.T) {
	deps := savedForgejoAlias(t)
	cat := testCatalog(&echoApp{id: "forgejo", done: map[string]bool{}})
	code, out := runWith(t, deps, cat, "credentials", "--json")
	var creds struct {
		Admin struct {
			Username string            `json:"username"`
			Aliases  map[string]string `json:"aliases"`
		} `json:"admin"`
		Apps map[string]map[string]string `json:"apps"`
	}
	if code != 0 || json.Unmarshal([]byte(out), &creds) != nil {
		t.Fatalf("credentials --json: exit %d\n%s", code, out)
	}
	if creds.Admin.Username != "admin" || creds.Admin.Aliases["forgejo"] != "selfhost-admin" {
		t.Fatalf("credentials --json does not name Forgejo's username alias: %s", out)
	}
	if _, raw := creds.Apps["forgejo"]["FORGEJO_ADMIN_USER"]; raw {
		t.Fatalf("the login alias should not be listed as an App secret: %s", out)
	}
}

func TestForgejoAliasIsNamedInCredentialsText(t *testing.T) {
	deps := savedForgejoAlias(t)
	cat := testCatalog(&echoApp{id: "forgejo", done: map[string]bool{}})
	code, out := runWith(t, deps, cat, "credentials")
	if code != 0 || !strings.Contains(out, "Shared Admin login") || !strings.Contains(out, "alias     forgejo selfhost-admin") || strings.Contains(out, "FORGEJO_ADMIN_USER") {
		t.Fatalf("credentials text does not name Forgejo's username alias: exit %d\n%s", code, out)
	}
}

func TestForgejoAliasIsVisibleInCredentialsAndDiagnostics(t *testing.T) {
	deps := savedForgejoAlias(t)
	cat := testCatalog(&echoApp{id: "forgejo", done: map[string]bool{}})
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	state, err := p.LoadState()
	if err != nil {
		t.Fatal(err)
	}
	state.Apps["forgejo"].Steps["configure"] = project.StepRecord{Status: "fail", Msg: "create selfhost-admin", Error: "refused synthetic-password", Hint: "sign in as selfhost-admin"}
	if err := p.SaveState(state); err != nil {
		t.Fatal(err)
	}
	code, out := runWith(t, deps, cat, "status", "--json")
	if code != 0 || !strings.Contains(out, "sign in as selfhost-admin") || strings.Contains(out, "synthetic-password") {
		t.Fatalf("username hidden or password leaked in diagnostics: exit %d\n%s", code, out)
	}
}
