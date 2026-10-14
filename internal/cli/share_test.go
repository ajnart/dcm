package cli_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestShareListsOnlyCatalogApps(t *testing.T) {
	deps := systemtest.NewDeps(t)
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	if err := p.SaveSettings(map[string]string{"EXPOSURE": "lan", "LAN_IP": "192.168.1.5"}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"two", "one"} {
		if err := p.MkdirAll("apps", id); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p.FragmentPath(id), []byte("services:\n  "+id+":\n    image: x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := p.MkdirAll("extra", "mine"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.Path("extra", "mine", "compose.yml"), []byte("services:\n  mine:\n    image: x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cat := testCatalog(&echoApp{id: "one"}, &echoApp{id: "two"})

	code, out := runWith(t, deps, cat, "share")
	want := "self-host install one two\nhttps://self-host.fyi/?apps=one,two#play\n"
	if code != 0 || out != want {
		t.Fatalf("share: exit %d\ngot %q\nwant %q", code, out, want)
	}

	code, out = runWith(t, deps, cat, "share", "--json")
	var got map[string]string
	if err := json.Unmarshal([]byte(out), &got); err != nil || code != 0 {
		t.Fatalf("share --json: exit %d, %v\n%s", code, err, out)
	}
	if got["install"] != "self-host install one two" || got["url"] != "https://self-host.fyi/?apps=one,two#play" || len(got) != 2 {
		t.Fatalf("share --json = %v", got)
	}
	if strings.Contains(out, "192.168.1.5") || strings.Contains(out, "mine") {
		t.Fatalf("share leaked more than Catalog App ids: %s", out)
	}
}

func TestShareWithoutAppsSaysSoAndExitsOK(t *testing.T) {
	deps := systemtest.NewDeps(t)
	code, out := runWith(t, deps, testCatalog(&echoApp{id: "one"}), "share")
	if code != 0 || strings.Count(out, "\n") != 1 || !strings.Contains(out, "No Apps to share") {
		t.Fatalf("share without a Project: exit %d\n%s", code, out)
	}
}
