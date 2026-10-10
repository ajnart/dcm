package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	tsapp "github.com/ajnart/self-host/internal/apps/tailscale"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	ts "github.com/ajnart/self-host/internal/tailscale"
)

const authKey = "tskey-auth-kTestKey123-secretsecretsecret"

type headlessApp struct{ testApp }

func (a *headlessApp) Info() app.Info {
	info := a.testApp.Info()
	info.NoWebUI = true
	return info
}

func TestTailscaleDoesNotGiveHeadlessAppsNodes(t *testing.T) {
	h := newHarness(t, tsapp.App{}, &headlessApp{testApp: testApp{id: "worker", done: map[string]bool{}}})
	net := &tailnet{running: []string{"tailscale", "worker"}}
	net.install(h)
	if err := h.installTailscale("worker"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(h.readFile("apps", "tailscale", "compose.yml"), "tailscale-worker") {
		t.Fatal("an App without a web page must not get a node")
	}
}

// tailnet fakes the Tailscale containers behind docker compose: which services
// run, and what `tailscale status --json` prints in each.
type tailnet struct {
	mu       sync.Mutex
	enrolled bool
	// status is the JSON of a node's status, by Compose service; a node
	// without one answers as a running node named <app>.tail1234.ts.net.
	status map[string]string
	// running lists the services `docker compose ps` reports.
	running []string
}

func runningNode(dnsName string, extra map[string]any) string {
	self := map[string]any{"DNSName": dnsName}
	for key, value := range extra {
		self[key] = value
	}
	body, _ := json.Marshal(map[string]any{"BackendState": "Running", "CertDomains": []string{strings.TrimSuffix(dnsName, ".")}, "Self": self})
	return string(body)
}

func (n *tailnet) install(h *harness) {
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		line := systemtest.Line(cmd)
		n.mu.Lock()
		defer n.mu.Unlock()
		switch {
		case strings.Contains(line, " ps "):
			var out strings.Builder
			for _, service := range n.running {
				out.WriteString(`{"Service":"` + service + `","State":"running"}` + "\n")
			}
			return system.Result{Stdout: []byte(out.String())}
		case strings.Contains(line, " exec ") && strings.Contains(line, " tailscale "):
			if strings.HasSuffix(line, " up") || strings.Contains(line, " up ") {
				n.enrolled = true
				return system.Result{}
			}
			_, rest, _ := strings.Cut(line, "exec -T ")
			service, _, _ := strings.Cut(rest, " ")
			if body, found := n.status[service]; found {
				return system.Result{Stdout: []byte(body)}
			}
			if service == "tailscale" {
				state := "Stopped"
				if n.enrolled {
					state = "Running"
				}
				return system.Result{Stdout: []byte(`{"BackendState":"` + state + `"}`)}
			}
			app := strings.TrimPrefix(service, "tailscale-")
			return system.Result{Stdout: []byte(runningNode(app+".tail1234.ts.net.", nil))}
		}
		return system.Result{}
	})
}

func newTailnetHarness(t *testing.T, web ...string) (*harness, *tailnet) {
	t.Helper()
	apps := []app.App{tsapp.App{}}
	done := map[string]bool{}
	for _, id := range web {
		apps = append(apps, &testApp{id: id, done: done})
	}
	h := newHarness(t, apps...)
	net := &tailnet{status: map[string]string{}, running: []string{"tailscale"}}
	for _, id := range web {
		net.running = append(net.running, id, ts.ServiceName(id))
	}
	net.install(h)
	return h, net
}

func (h *harness) installTailscale(extra ...string) error {
	h.t.Helper()
	return h.svc.Install(context.Background(), InstallOptions{
		Targets:       append([]string{"tailscale"}, extra...),
		PrivateInputs: map[string]map[string]string{"tailscale": {"auth_key": authKey}},
	})
}

func (h *harness) readFile(rel ...string) string {
	h.t.Helper()
	data, err := os.ReadFile(filepath.Join(append([]string{h.root()}, rel...)...))
	if err != nil {
		h.t.Fatal(err)
	}
	return string(data)
}

func TestInstallGivesEachWebAppItsOwnTailscaleNode(t *testing.T) {
	h, _ := newTailnetHarness(t, "jellyfin", "immich")
	if err := h.installTailscale("jellyfin", "immich"); err != nil {
		t.Fatalf("install: %v", err)
	}
	fragment := h.readFile("apps", "tailscale", "compose.yml")
	for _, id := range []string{"jellyfin", "immich"} {
		if !strings.Contains(fragment, "  tailscale-"+id+":\n") {
			t.Errorf("no node for %s in:\n%s", id, fragment)
		}
		serve := h.readFile("apps", "tailscale", "nodes", id, "config", "serve.json")
		if !strings.Contains(serve, `"Proxy": "http://`+id+`:80"`) || strings.Contains(serve, "Funnel") {
			t.Errorf("serve.json for %s = %s", id, serve)
		}
	}
	if strings.Contains(fragment, "tailscale-tailscale") {
		t.Error("the Tailscale App must not front itself")
	}
}

func TestInstallingAWebAppLaterStartsItsNode(t *testing.T) {
	h, _ := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale(); err != nil {
		t.Fatalf("install tailscale: %v", err)
	}
	if strings.Contains(h.readFile("apps", "tailscale", "compose.yml"), "tailscale-jellyfin") {
		t.Fatal("no App has a web page yet, so there is no node")
	}
	if err := h.install("jellyfin"); err != nil {
		t.Fatalf("install jellyfin: %v", err)
	}
	if !strings.Contains(h.readFile("apps", "tailscale", "compose.yml"), "tailscale-jellyfin") {
		t.Error("the new App has no node")
	}
	calls := h.composeCalls()
	if !slices.ContainsFunc(calls, func(c string) bool { return strings.HasPrefix(c, "up -d") && strings.Contains(c, "tailscale-jellyfin") }) {
		t.Errorf("the node was never started: %v", calls)
	}
}

func TestInstallingTailscaleAfterAWebAppFrontsIt(t *testing.T) {
	h, _ := newTailnetHarness(t, "jellyfin")
	if err := h.install("jellyfin"); err != nil {
		t.Fatalf("install jellyfin: %v", err)
	}
	if err := h.installTailscale(); err != nil {
		t.Fatalf("install tailscale: %v", err)
	}
	if !strings.Contains(h.readFile("apps", "tailscale", "compose.yml"), "tailscale-jellyfin") {
		t.Error("an App installed before Tailscale has no node")
	}
}

func TestRemovingAnAppRemovesItsNode(t *testing.T) {
	h, _ := newTailnetHarness(t, "jellyfin", "immich")
	if err := h.installTailscale("jellyfin", "immich"); err != nil {
		t.Fatalf("install: %v", err)
	}
	if err := h.svc.Remove(context.Background(), []string{"jellyfin"}, false); err != nil {
		t.Fatalf("remove: %v", err)
	}
	fragment := h.readFile("apps", "tailscale", "compose.yml")
	if strings.Contains(fragment, "tailscale-jellyfin") || !strings.Contains(fragment, "tailscale-immich") {
		t.Errorf("fragment after removing Jellyfin:\n%s", fragment)
	}
	if !slices.ContainsFunc(h.composeCalls(), func(c string) bool {
		return strings.HasPrefix(c, "rm --stop --force") && strings.Contains(c, "tailscale-jellyfin")
	}) {
		t.Errorf("the node's container was not removed: %v", h.composeCalls())
	}
}

func TestAuthKeyOnlyEverLandsInItsPrivateFiles(t *testing.T) {
	h, _ := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatalf("install: %v", err)
	}
	for _, call := range h.runner.Calls() {
		if strings.Contains(call, "secretsecret") {
			t.Errorf("a command carries the key: %s", call)
		}
	}
	h.rec.mu.Lock()
	for _, e := range h.rec.events {
		if body, _ := json.Marshal(e); strings.Contains(string(body), "secretsecret") {
			t.Errorf("an event carries the key: %s", body)
		}
	}
	h.rec.mu.Unlock()
	err := filepath.WalkDir(h.root(), func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, _ := os.ReadFile(path)
		rel, _ := filepath.Rel(h.root(), path)
		allowed := rel == "secrets.env" || rel == filepath.Join("apps", "tailscale", "keys", "auth-key")
		if strings.Contains(string(data), "secretsecret") && !allowed {
			t.Errorf("the key leaked into %s", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(h.root(), "apps", "tailscale", "keys", "auth-key"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("key file: %v, mode %v, want 0600", err, info)
	}
}

func TestStatusAddsTheRealTailscaleAddress(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatalf("install: %v", err)
	}
	net.status["tailscale-jellyfin"] = runningNode("jellyfin-1.tail1234.ts.net.", nil)

	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var jellyfin AppStatus
	for _, a := range status.Apps {
		if a.ID == "jellyfin" {
			jellyfin = a
		}
	}
	want := []string{"http://192.168.1.20:9000", "https://jellyfin-1.tail1234.ts.net"}
	if !slices.Equal(jellyfin.Addresses, want) || jellyfin.URL != want[0] {
		t.Errorf("addresses %q url %q, want %q first", jellyfin.Addresses, jellyfin.URL, want)
	}
	if !slices.Equal(status.Access, []string{"home", "tailscale"}) {
		t.Errorf("access = %q, want home and tailscale", status.Access)
	}
}

func TestStatusKeepsOnlyTheHomeAddressUntilTheNodeIsRunning(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatalf("install: %v", err)
	}
	net.status["tailscale-jellyfin"] = `{"BackendState":"NeedsLogin"}`

	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range status.Apps {
		if a.ID == "jellyfin" && !slices.Equal(a.Addresses, []string{"http://192.168.1.20:9000"}) {
			t.Errorf("addresses = %q, want only the home one", a.Addresses)
		}
	}
}

func TestStatusWithoutTailscaleIsUnchanged(t *testing.T) {
	h, _ := newTailnetHarness(t, "jellyfin")
	if err := h.install("jellyfin"); err != nil {
		t.Fatal(err)
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(status.Access, []string{"home"}) {
		t.Errorf("access = %q, want only home", status.Access)
	}
}

func tailscaleChecks(t *testing.T, h *harness) []string {
	t.Helper()
	var out []string
	for _, c := range h.svc.Doctor(context.Background()) {
		if c.App == "tailscale" && c.ID != "running" && c.Level != "ok" {
			out = append(out, string(c.Level)+": "+c.Detail+" | "+c.Hint)
		}
	}
	return out
}

func TestDoctorWarnsInPlainWordsWhenTheSignInRunsOutSoon(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatalf("install: %v", err)
	}
	soon := h.deps.Now().Add(12*24*time.Hour - time.Hour).UTC().Format(time.RFC3339)
	net.status["tailscale-jellyfin"] = runningNode("jellyfin.tail1234.ts.net.", map[string]any{"KeyExpiry": soon})

	got := tailscaleChecks(t, h)
	want := "warn: The Tailscale sign-in of jellyfin runs out in 12 days. | Open https://login.tailscale.com/admin/machines, find the App's name and choose Disable key expiry."
	if !slices.Contains(got, want) {
		t.Errorf("checks = %q, want %q", got, want)
	}
}

func TestDoctorFailsWhenAnAppIsSignedOutOfTailscale(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatalf("install: %v", err)
	}
	net.status["tailscale-jellyfin"] = `{"BackendState":"NeedsLogin"}`

	got := tailscaleChecks(t, h)
	if len(got) != 1 || !strings.HasPrefix(got[0], "fail: jellyfin is signed out of Tailscale, so its private name does not work. | Make a new key at https://login.tailscale.com/admin/settings/keys") {
		t.Errorf("checks = %q", got)
	}
}

func TestDoctorSaysWhereToTurnOnHTTPS(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatalf("install: %v", err)
	}
	net.status["tailscale-jellyfin"] = `{"BackendState":"Running","CertDomains":[],"Self":{"DNSName":"jellyfin.tail1234.ts.net."}}`

	got := tailscaleChecks(t, h)
	if len(got) != 1 || !strings.Contains(got[0], "HTTPS is not turned on") || !strings.Contains(got[0], "https://login.tailscale.com/admin/dns") {
		t.Errorf("checks = %q", got)
	}
}
