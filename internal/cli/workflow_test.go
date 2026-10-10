package cli_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/service"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestStatusRemembersInstallStagesBeforeSetupPerApp(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, "install", "pair", "--yes", "--json"); code != 0 {
		t.Fatalf("install: exit %d\n%s", code, out)
	}
	// Each CLI invocation opens the Project again, without the install's session.
	code, out := runWith(t, deps, cat, "status", "--json")
	if code != 0 {
		t.Fatalf("status: exit %d\n%s", code, out)
	}
	var status service.Status
	if err := json.Unmarshal([]byte(out), &status); err != nil {
		t.Fatal(err)
	}
	if len(status.Apps) != 2 {
		t.Fatalf("Apps = %v, want two", status.Apps)
	}
	for _, a := range status.Apps {
		var ids []string
		for _, step := range a.Steps {
			ids = append(ids, step.ID)
			if step.Status != stepstatus.StepOK || step.Msg == "" {
				t.Errorf("%s step = %+v, want success with message", a.ID, step)
			}
		}
		if want := []string{"render", "pull", "start", "configure", "check"}; !reflect.DeepEqual(ids, want) {
			t.Fatalf("%s steps = %v, want %v", a.ID, ids, want)
		}
	}
}

func TestStatusRemembersFailedPullWithHintPerApp(t *testing.T) {
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	deps.Runner.(*systemtest.Runner).OnStreamError("--progress json pull", "", errors.New("exit status 125"))
	code, out := runWith(t, deps, cat, "install", "pair", "--yes", "--json")
	if code == 0 {
		t.Fatal("install succeeded despite failed pull")
	}
	failure := findCheck(decodeEvents(t, out), "pull")
	if failure == nil || failure["hint"] == "" {
		t.Fatalf("pull failure with hint missing: %s", out)
	}
	code, out = runWith(t, deps, cat, "status", "--json")
	if code != 0 {
		t.Fatalf("status: exit %d\n%s", code, out)
	}
	var status service.Status
	if err := json.Unmarshal([]byte(out), &status); err != nil {
		t.Fatal(err)
	}
	if len(status.Apps) != 2 {
		t.Fatalf("Apps = %v, want two", status.Apps)
	}
	for _, a := range status.Apps {
		if len(a.Steps) != 2 || a.Steps[0].ID != "render" || a.Steps[1].ID != "pull" {
			t.Fatalf("%s steps = %+v, want render and failed pull", a.ID, a.Steps)
		}
		pull := a.Steps[1]
		if pull.Status != stepstatus.StepFail || pull.Error != failure["error"] || pull.Hint != failure["hint"] || pull.Msg != failure["msg"] {
			t.Fatalf("%s pull = %+v, want CLI failure %+v", a.ID, pull, failure)
		}
	}
}
