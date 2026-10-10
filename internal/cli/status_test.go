package cli_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/project"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestStatusJSONIgnoresTheAppearance(t *testing.T) {
	deps := systemtest.NewDeps(t)
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	if err := p.SaveSettings(map[string]string{"EXPOSURE": "lan", "TZ": "UTC"}); err != nil {
		t.Fatal(err)
	}
	cat := testCatalog(&echoApp{id: "one"})
	_, before := runWith(t, deps, cat, "status", "--json")

	if err := p.SaveAppearance(project.Appearance{Glyphs: "nerd-font"}); err != nil {
		t.Fatal(err)
	}

	code, after := runWith(t, deps, cat, "status", "--json")
	if code != 0 || after != before {
		t.Fatalf("status JSON changed with the appearance: exit %d\ngot %s\nwant %s", code, after, before)
	}
}

func TestStatusJSONKeepsLegacyStrings(t *testing.T) {
	deps := systemtest.NewDeps(t)
	owner, _ := deps.CurrentUser()
	p := project.Open(owner)
	if err := p.SaveSettings(map[string]string{"EXPOSURE": "local"}); err != nil {
		t.Fatal(err)
	}
	if err := p.MkdirAll("apps", "one"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.FragmentPath("one"), []byte("services:\n  one:\n    image: example/echo:latest\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	root, err := json.Marshal(p.Root)
	if err != nil {
		t.Fatal(err)
	}
	for _, setup := range []string{"ok", "incomplete", "manual", "pending", "unmanaged"} {
		t.Run(setup, func(t *testing.T) {
			legacy := fmt.Sprintf(`{"version":1,"apps":{"one":{"port":0,"setup":%q,"steps":{"a":{"status":"ok"},"b":{"status":"skip"},"c":{"status":"fail"},"d":{"status":"manual"}},"step_order":["a","b","c","d"]}}}`, setup)
			if err := os.WriteFile(p.Path("state.json"), []byte(legacy), 0o644); err != nil {
				t.Fatal(err)
			}
			expected := fmt.Sprintf(`{"project":%s,"exposure":"local","access":["local"],"lan_ip":"","settings":{"EXPOSURE":"local"},"apps":[{"id":"one","name":"Echo one","managed":true,"image":"example/echo:latest","state":"missing","setup":%q,"steps":[{"id":"a","status":"ok"},{"id":"b","status":"skip"},{"id":"c","status":"fail"},{"id":"d","status":"manual"}],"services":["one"]}]}`, root, setup)
			var want bytes.Buffer
			if err := json.Indent(&want, []byte(expected), "", "  "); err != nil {
				t.Fatal(err)
			}
			want.WriteByte('\n')
			code, got := runWith(t, deps, testCatalog(&echoApp{id: "one"}), "status", "--json")
			if code != 0 || got != want.String() {
				t.Fatalf("status JSON changed: exit %d\ngot %s\nwant %s", code, got, want.String())
			}
		})
	}
}

func TestStatusJSONNamesTheAccessInUse(t *testing.T) {
	for _, tc := range []struct{ exposure, want string }{{"lan", "home"}, {"", "home"}, {"local", "local"}} {
		t.Run(tc.exposure, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			owner, _ := deps.CurrentUser()
			if err := project.Open(owner).SaveSettings(map[string]string{"EXPOSURE": tc.exposure}); err != nil {
				t.Fatal(err)
			}

			code, out := runWith(t, deps, testCatalog(&echoApp{id: "one"}), "status", "--json")

			var status struct {
				Exposure string
				Access   []string
			}
			if err := json.Unmarshal([]byte(out), &status); err != nil || code != 0 {
				t.Fatalf("exit %d: %v\n%s", code, err, out)
			}
			if status.Exposure != tc.exposure || strings.Join(status.Access, ",") != tc.want {
				t.Fatalf("exposure %q access %v, want exposure %q access %s", status.Exposure, status.Access, tc.exposure, tc.want)
			}
		})
	}
}
