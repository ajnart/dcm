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
			expected := fmt.Sprintf(`{"project":%s,"exposure":"local","lan_ip":"","settings":{"EXPOSURE":"local"},"apps":[{"id":"one","name":"Echo one","managed":true,"description":"test app","image":"example/echo:latest","state":"missing","setup":%q,"steps":[{"id":"a","status":"ok"},{"id":"b","status":"skip"},{"id":"c","status":"fail"},{"id":"d","status":"manual"}],"services":["one"]}],"home":%s}`, root, setup, root)
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

func TestStatusJSONGoldenForAnAppInstalledThroughARecipe(t *testing.T) {
	deps := systemtest.NewDeps(t)
	done := map[string]bool{}
	cat := testCatalog(&echoApp{id: "one", done: done}, &echoApp{id: "two", done: done})
	if code, out := runWith(t, deps, cat, "install", "one", "--yes", "--json"); code != 0 {
		t.Fatalf("install one exit %d\n%s", code, out)
	}
	if code, out := runWith(t, deps, cat, "install", "pair", "--yes", "--json"); code != 0 {
		t.Fatalf("install pair exit %d\n%s", code, out)
	}
	owner, _ := deps.CurrentUser()
	want := strings.NewReplacer("{HOME}", owner.Home, "{ROOT}", projectRoot(t, deps)).Replace(`{
  "project": "{ROOT}",
  "exposure": "lan",
  "lan_ip": "192.168.1.20",
  "settings": {
    "BIND_IP": "0.0.0.0",
    "DOWNLOADS_ROOT": "{HOME}/downloads",
    "EXPOSURE": "lan",
    "LAN_IP": "192.168.1.20",
    "MEDIA_ROOT": "{HOME}/media",
    "PGID": "1000",
    "PUID": "1000",
    "TZ": "Europe/Paris",
    "UMASK": "022"
  },
  "apps": [
    {
      "id": "one",
      "name": "Echo one",
      "managed": true,
      "description": "test app",
      "url": "http://192.168.1.20:9000",
      "addresses": [
        "http://192.168.1.20:9000"
      ],
      "port": 9000,
      "image": "example/echo:latest",
      "state": "missing",
      "setup": "ok",
      "steps": [
        {
          "id": "render",
          "status": "ok",
          "msg": "wrote apps/one/compose.yml (example/echo:latest on port 9000)"
        },
        {
          "id": "pull",
          "status": "ok",
          "msg": "pulled one, two"
        },
        {
          "id": "start",
          "status": "ok",
          "msg": "started one, two"
        },
        {
          "id": "configure",
          "status": "skip",
          "msg": "configure echo"
        },
        {
          "id": "check",
          "status": "ok",
          "msg": "verify Echo one works"
        }
      ],
      "services": [
        "one"
      ]
    },
    {
      "id": "two",
      "name": "Echo two",
      "managed": true,
      "description": "test app",
      "recipe": "pair",
      "url": "http://192.168.1.20:9001",
      "addresses": [
        "http://192.168.1.20:9001"
      ],
      "port": 9001,
      "image": "example/echo:latest",
      "state": "missing",
      "setup": "ok",
      "steps": [
        {
          "id": "render",
          "status": "ok",
          "msg": "wrote apps/two/compose.yml (example/echo:latest on port 9001)"
        },
        {
          "id": "pull",
          "status": "ok",
          "msg": "pulled one, two"
        },
        {
          "id": "start",
          "status": "ok",
          "msg": "started one, two"
        },
        {
          "id": "configure",
          "status": "ok",
          "msg": "configure echo"
        },
        {
          "id": "check",
          "status": "ok",
          "msg": "verify Echo two works"
        }
      ],
      "services": [
        "two"
      ]
    }
  ],
  "home": "{ROOT}"
}
`)
	code, got := runWith(t, deps, cat, "status", "--json")
	if code != 0 || got != want {
		t.Fatalf("status JSON changed: exit %d\ngot %s\nwant %s", code, got, want)
	}
}

func TestStatusPlainOpensWithASummaryNamingEachAppByWhatItIsFor(t *testing.T) {
	deps := systemtest.NewDeps(t)
	done := map[string]bool{}
	cat := testCatalog(&echoApp{id: "one", done: done}, &echoApp{id: "homarr", done: done})
	if code, out := runWith(t, deps, cat, "install", "one", "homarr", "--yes", "--json"); code != 0 {
		t.Fatalf("install exit %d\n%s", code, out)
	}
	code, got := runWith(t, deps, cat, "status")
	want := "You have 2 Apps.\n" +
		"test app: Echo one at http://192.168.1.20:9000\n" +
		"Dashboard: Echo homarr at http://192.168.1.20:9001\n" +
		"Everything lives in " + projectRoot(t, deps) + ".\n" +
		"\n" +
		"Project   " + projectRoot(t, deps) + "\n"
	if code != 0 || !strings.HasPrefix(got, want) {
		t.Fatalf("status does not open with the summary: exit %d\ngot %s\nwant prefix %s", code, got, want)
	}
}
