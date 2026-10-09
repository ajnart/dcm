package cli_test

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

const office, home = "10.36.56.243", "192.168.0.12"

// installedAtOffice installs "one" (whose Compose file uses ${LAN_IP}) and
// "two" on the office network, then moves the machine to the home network.
func installedAtOffice(t *testing.T) (*system.Deps, *catalog.Catalog) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	deps.LANIP = func() (string, error) { return office, nil }
	cat := testCatalog(&echoApp{id: "one", baseURL: true, done: map[string]bool{}}, &echoApp{id: "two", done: map[string]bool{}})
	if code, out := runWith(t, deps, cat, "install", "--yes", "one", "two"); code != 0 {
		t.Fatalf("install: %d\n%s", code, out)
	}
	deps.LANIP = func() (string, error) { return home, nil }
	return deps, cat
}

func TestStatusAndDoctorFlagALANIPThatIsNoLongerOnThisMachine(t *testing.T) {
	deps, cat := installedAtOffice(t)

	_, out := runWith(t, deps, cat, "status", "--json")
	var status struct {
		LANIPStale bool     `json:"lan_ip_stale"`
		HostIPs    []string `json:"host_ips"`
	}
	if err := json.Unmarshal([]byte(out), &status); err != nil || !status.LANIPStale || !slices.Equal(status.HostIPs, []string{home}) {
		t.Fatalf("status should flag the stale LAN IP: %v\n%s", err, out)
	}
	if _, text := runWith(t, deps, cat, "status"); !strings.Contains(text, "not an address of this machine") || !strings.Contains(text, "LAN_IP=auto") {
		t.Fatalf("status recap should warn:\n%s", text)
	}

	check := clitest.Run(t, deps, cat, "doctor", "--json").Step("", "lan-ip")
	if check == nil || check["event"] != "step.warn" {
		t.Fatalf("doctor should warn about the LAN IP: %v", check)
	}
	if msg := check["msg"].(string); !strings.Contains(msg, office) || !strings.Contains(msg, home) {
		t.Fatalf("warning should name the stored and current addresses: %q", msg)
	}
	if !strings.Contains(check["hint"].(string), "self-host config set LAN_IP=auto") {
		t.Fatalf("hint should give the fix: %v", check["hint"])
	}
}

func TestDoctorAcceptsALANIPThatIsStillOnThisMachine(t *testing.T) {
	deps, cat := installedAtOffice(t)
	deps.HostIPs = func() ([]string, error) { return []string{home, office}, nil }

	if check := clitest.Run(t, deps, cat, "doctor", "--json").Step("", "lan-ip"); check == nil || check["event"] != "step.ok" {
		t.Fatalf("an address the machine still has is not stale: %v", check)
	}
}

func TestConfigSetLANIPAutoRedetectsAndRecreatesTheAppsThatUseIt(t *testing.T) {
	deps, cat := installedAtOffice(t)

	code, out := runWith(t, deps, cat, "config", "set", "LAN_IP=auto")

	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	if env := readFile(t, filepath.Join(projectRoot(t, deps), ".env")); !strings.Contains(env, "LAN_IP="+home+"\n") {
		t.Fatalf(".env not re-detected:\n%s", env)
	}
	if lastCompose(deps) != "up -d --remove-orphans one" {
		t.Fatalf("only the App using LAN_IP should be recreated, last call %q", lastCompose(deps))
	}
	if _, out := runWith(t, deps, cat, "status", "--json"); strings.Contains(out, "lan_ip_stale") {
		t.Fatalf("still stale after re-detect:\n%s", out)
	}
}

func TestConfigReviewShowsDriftAndFixesItKeepingInstalledApps(t *testing.T) {
	deps, cat := installedAtOffice(t)
	deps.TimeZone = func() string { return "America/New_York" }
	root := projectRoot(t, deps)
	kept := map[string]string{}
	for _, name := range []string{"secrets.env", "compose.yml", "apps/one/compose.yml", "apps/two/compose.yml"} {
		kept[name] = readFile(t, filepath.Join(root, name))
	}

	_, out := runWith(t, deps, cat, "config", "review", "--json")
	var review struct{ Fixes []string }
	if err := json.Unmarshal([]byte(out), &review); err != nil || !slices.Equal(review.Fixes, []string{"LAN_IP=" + home, "TZ=America/New_York"}) {
		t.Fatalf("review fixes: %v\n%s", err, out)
	}
	if env := readFile(t, filepath.Join(root, ".env")); !strings.Contains(env, "LAN_IP="+office) {
		t.Fatal("review without --yes must not change anything")
	}

	if code, out := runWith(t, deps, cat, "config", "review", "--yes"); code != 0 || !strings.Contains(out, "Applied") {
		t.Fatalf("review --yes: %d\n%s", code, out)
	}

	env := readFile(t, filepath.Join(root, ".env"))
	if !strings.Contains(env, "LAN_IP="+home+"\n") || !strings.Contains(env, "TZ=America/New_York\n") {
		t.Fatalf("fixes not applied:\n%s", env)
	}
	for name, before := range kept {
		if readFile(t, filepath.Join(root, name)) != before {
			t.Errorf("%s changed; review must keep installs", name)
		}
	}
	_, out = runWith(t, deps, cat, "status", "--json")
	var status struct {
		Apps []struct {
			ID    string
			Setup stepstatus.Setup
		}
	}
	if err := json.Unmarshal([]byte(out), &status); err != nil || len(status.Apps) != 2 || status.Apps[0].Setup != stepstatus.SetupOK || status.Apps[1].Setup != stepstatus.SetupOK {
		t.Fatalf("installed Apps lost: %v\n%s", err, out)
	}
}
