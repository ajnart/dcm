package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/app"
	tsapp "github.com/ajnart/self-host/internal/apps/tailscale"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	ts "github.com/ajnart/self-host/internal/tailscale"
)

const authKey = "tskey-auth-kTestKey123-secretsecretsecret"

type tailscaleHTTP func(*http.Request) (*http.Response, error)

func (f tailscaleHTTP) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDoctorObservesLocalPageNotPreferredPrivateAddress(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatal(err)
	}
	net.status["tailscale-jellyfin"] = runningNode("jellyfin-1.example.ts.net.", nil)
	var observed []string
	h.deps.HTTP = &http.Client{Transport: tailscaleHTTP(func(r *http.Request) (*http.Response, error) {
		observed = append(observed, r.URL.String())
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("local page")), Header: http.Header{}}, nil
	})}
	h.svc.Doctor(context.Background())
	if !slices.Contains(observed, "http://192.168.1.20:9000") || slices.Contains(observed, "https://jellyfin-1.example.ts.net") {
		t.Fatalf("Doctor observed %v instead of the local App page", observed)
	}
}

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
	status       map[string]string
	failStatus   bool
	failPull     bool
	failStartup  bool
	trackStartup bool
	stopped      []string
	unknown      []string
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
		case n.failPull && strings.Contains(line, " pull "):
			return system.Result{ExitCode: 1, Stderr: []byte("pull failed")}
		case strings.Contains(line, " up -d "):
			if n.failStartup {
				return system.Result{ExitCode: 1, Stderr: []byte("startup failed before creating containers")}
			}
			if n.trackStartup {
				for i, arg := range cmd.Args {
					if arg == "--remove-orphans" {
						for _, service := range cmd.Args[i+1:] {
							if !slices.Contains(n.running, service) {
								n.running = append(n.running, service)
							}
						}
						break
					}
				}
			}
			return system.Result{}
		case strings.Contains(line, " ps "):
			var out strings.Builder
			for _, service := range n.running {
				if service == "access-caddy" {
					out.WriteString(`{"Service":"access-caddy","State":"running","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":80,"Protocol":"tcp"}]}` + "\n")
					continue
				}
				out.WriteString(`{"Service":"` + service + `","State":"running"}` + "\n")
			}
			for _, service := range n.stopped {
				out.WriteString(`{"Service":"` + service + `","State":"exited"}` + "\n")
			}
			for _, service := range n.unknown {
				out.WriteString(`{"Service":"` + service + `","State":"unknown"}` + "\n")
			}
			return system.Result{Stdout: []byte(out.String())}
		case strings.Contains(line, " exec ") && strings.Contains(line, " tailscale "):
			if n.failStatus && strings.Contains(line, "tailscale-jellyfin") {
				return system.Result{ExitCode: 1, Stderr: []byte("sensitive diagnostic payload")}
			}
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

func TestApprovedInstallRetriesCreateAbsentPrivateNode(t *testing.T) {
	for _, phase := range []string{"pull", "startup"} {
		t.Run(phase, func(t *testing.T) {
			h, net := newTailnetHarness(t, "jellyfin", "immich")
			if err := h.installTailscale("immich"); err != nil {
				t.Fatal(err)
			}
			net.running = []string{"tailscale", "immich"}
			net.stopped = []string{"tailscale-immich"}
			net.trackStartup = true
			net.failPull, net.failStartup = phase == "pull", phase == "startup"
			if err := h.install("jellyfin"); err == nil {
				t.Fatal("expected failed install")
			}
			if !strings.Contains(h.readFile("apps", "tailscale", "compose.yml"), "tailscale-jellyfin") {
				t.Fatal("failure must leave a declared node for this regression")
			}
			net.failPull, net.failStartup = false, false
			before := len(h.composeCalls())
			if err := h.install("jellyfin"); err != nil {
				t.Fatal(err)
			}
			if !slices.Contains(net.running, "tailscale-jellyfin") {
				t.Fatal("retry skipped the declared but absent node")
			}
			for _, call := range h.composeCalls()[before:] {
				if strings.Contains(call, "pull ") || strings.HasPrefix(call, "up -d") {
					if strings.Contains(call, "tailscale-immich") || strings.HasSuffix(call, " tailscale") {
						t.Fatalf("retry touched stopped peer or connector: %s", call)
					}
				}
			}
			status, err := h.svc.Status(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			for _, a := range status.Apps {
				if a.ID == "jellyfin" && a.URL != "https://jellyfin.tail1234.ts.net" {
					t.Fatalf("retry private Address = %q", a.URL)
				}
			}
		})
	}
}

func TestPartialRestoreStartsDeclaredAbsentPrivateNode(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin", "immich")
	if err := h.installTailscale("jellyfin", "immich"); err != nil {
		t.Fatal(err)
	}
	archive, err := h.svc.Backup(context.Background(), []string{"jellyfin"}, filepath.Join(t.TempDir(), "jellyfin.tar.zst"), "")
	if err != nil {
		t.Fatal(err)
	}
	net.running = []string{"tailscale", "jellyfin", "immich"}
	net.stopped = []string{"tailscale-immich"}
	net.trackStartup = true
	before := len(h.composeCalls())
	if err := h.svc.Restore(context.Background(), archive, []string{"jellyfin"}, ""); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(net.running, "tailscale-jellyfin") {
		t.Fatal("Restore skipped the declared but absent node")
	}
	for _, call := range h.composeCalls()[before:] {
		if strings.HasPrefix(call, "up -d") && (strings.Contains(call, "tailscale-immich") || strings.HasSuffix(call, " tailscale")) {
			t.Fatalf("Restore restarted stopped peer or connector: %s", call)
		}
	}
}

func TestUnknownPrivateContainerIsNotTreatedAsAbsent(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatal(err)
	}
	net.running = []string{"tailscale", "jellyfin"}
	net.unknown = []string{"tailscale-jellyfin"}
	net.trackStartup = true
	before := len(h.composeCalls())
	if err := h.install("jellyfin"); err != nil {
		t.Fatal(err)
	}
	for _, call := range h.composeCalls()[before:] {
		if (strings.Contains(call, "pull ") || strings.HasPrefix(call, "up -d")) && strings.Contains(call, "tailscale") {
			t.Fatalf("unknown inventory caused invented startup: %s", call)
		}
	}
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range status.Apps {
		if a.ID == "jellyfin" && strings.HasPrefix(a.URL, "https:") {
			t.Fatal("unknown container invented a private Address")
		}
	}
	if got := strings.Join(tailscaleChecks(t, h), "\n"); !strings.Contains(got, "jellyfin: private Access could not be inspected") {
		t.Fatalf("unknown inventory needs a safe warning, got %q", got)
	}
}

func TestExistingStoppedPrivateNodesStayStoppedDuringApprovedMutations(t *testing.T) {
	for _, action := range []string{"install", "restore"} {
		for _, target := range []string{"jellyfin", "immich"} {
			t.Run(action+"/"+target, func(t *testing.T) {
				h, net := newTailnetHarness(t, "jellyfin", "immich")
				if err := h.installTailscale("jellyfin", "immich"); err != nil {
					t.Fatal(err)
				}
				archive, err := h.svc.Backup(context.Background(), []string{target}, filepath.Join(t.TempDir(), "backup.tar.zst"), "")
				if err != nil {
					t.Fatal(err)
				}
				net.running = []string{"tailscale", "jellyfin", "immich", "tailscale-immich"}
				net.stopped = []string{"tailscale-jellyfin"}
				net.trackStartup = true
				before := len(h.composeCalls())
				if action == "install" {
					err = h.install(target)
				} else {
					err = h.svc.Restore(context.Background(), archive, []string{target}, "")
				}
				if err != nil {
					t.Fatal(err)
				}
				for _, call := range h.composeCalls()[before:] {
					if (strings.Contains(call, "pull ") || strings.HasPrefix(call, "up -d")) && strings.Contains(call, "tailscale") {
						t.Fatalf("mutation started existing Access: %s", call)
					}
				}
				if slices.Contains(net.running, "tailscale-jellyfin") {
					t.Fatal("existing stopped node was treated as absent")
				}
			})
		}
	}
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
	h, net := newTailnetHarness(t, "jellyfin")
	net.running = []string{"tailscale"}
	net.trackStartup = true
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
	want := []string{"https://jellyfin-1.tail1234.ts.net", "http://192.168.1.20:9000"}
	if !slices.Equal(jellyfin.Addresses, want) || jellyfin.URL != want[0] {
		t.Errorf("addresses %q url %q, want %q first", jellyfin.Addresses, jellyfin.URL, want)
	}
	if !slices.Equal(status.Access, []string{"home", "tailscale"}) {
		t.Errorf("access = %q, want home and tailscale", status.Access)
	}
	report, err := h.svc.Debug(context.Background(), "jellyfin")
	if err != nil {
		t.Fatal(err)
	}
	if report.HealthCheck.URL != want[1] {
		t.Fatalf("local health observation moved to %q", report.HealthCheck.URL)
	}
}

func TestUnrelatedInstallsDoNotStartStoppedTailscale(t *testing.T) {
	for _, target := range []string{"worker", "jellyfin", "immich"} {
		t.Run(target, func(t *testing.T) {
			h, net := newTailnetHarness(t, "jellyfin", "immich")
			h.svc.Catalog = catalog.New(append(h.svc.Catalog.Apps(), &headlessApp{testApp: testApp{id: "worker", done: map[string]bool{}}}), nil)
			if err := h.installTailscale("jellyfin"); err != nil {
				t.Fatal(err)
			}
			net.running = []string{"jellyfin"}
			before := len(h.composeCalls())
			if err := h.install(target); err != nil {
				t.Fatal(err)
			}
			for _, call := range h.composeCalls()[before:] {
				if (strings.Contains(call, "pull ") || strings.HasPrefix(call, "up -d")) && strings.Contains(call, "tailscale") {
					t.Fatalf("unapproved Access startup: %s", call)
				}
			}
		})
	}
}

func TestNewNodeDoesNotRestartUnrelatedStoppedNodes(t *testing.T) {
	h, net := newTailnetHarness(t, "jellyfin", "immich")
	if err := h.installTailscale("jellyfin"); err != nil {
		t.Fatal(err)
	}
	net.running = []string{"tailscale", "immich"}
	before := len(h.composeCalls())
	if err := h.install("immich"); err != nil {
		t.Fatal(err)
	}
	started := false
	for _, call := range h.composeCalls()[before:] {
		if strings.HasPrefix(call, "up -d") {
			started = strings.Contains(call, "tailscale-immich")
			if strings.Contains(call, "tailscale-jellyfin") || strings.HasSuffix(call, " tailscale") {
				t.Fatalf("restarted unrelated Access: %s", call)
			}
		}
	}
	if !started {
		t.Fatal("new App's approved node was not started")
	}
}

func TestRestoreReconcilesPrivateAccess(t *testing.T) {
	for _, restoreAccess := range []bool{false, true} {
		for _, active := range []bool{false, true} {
			t.Run(fmt.Sprintf("access=%v/active=%v", restoreAccess, active), func(t *testing.T) {
				h, net := newTailnetHarness(t, "jellyfin", "immich")
				if err := h.installTailscale("jellyfin"); err != nil {
					t.Fatal(err)
				}
				id := "jellyfin"
				if restoreAccess {
					id = "tailscale"
				}
				archive, err := h.svc.Backup(context.Background(), []string{id}, filepath.Join(t.TempDir(), "backup.tar.zst"), "")
				if err != nil {
					t.Fatal(err)
				}
				if restoreAccess {
					if err := h.svc.Remove(context.Background(), []string{"jellyfin"}, false); err != nil {
						t.Fatal(err)
					}
					if err := h.install("immich"); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := h.install("immich"); err != nil {
						t.Fatal(err)
					}
					if err := h.svc.Remove(context.Background(), []string{"jellyfin"}, false); err != nil {
						t.Fatal(err)
					}
				}
				net.running = []string{"immich"}
				if active {
					net.running = append(net.running, "tailscale")
				}
				before := len(h.composeCalls())
				if err := h.svc.Restore(context.Background(), archive, []string{id}, ""); err != nil {
					t.Fatal(err)
				}
				fragment := h.readFile("apps", "tailscale", "compose.yml")
				if !strings.Contains(fragment, "tailscale-immich") || strings.Contains(fragment, "tailscale-jellyfin") == restoreAccess {
					t.Fatal("restore did not reconcile merged App inventory")
				}
				started := false
				for _, call := range h.composeCalls()[before:] {
					if strings.HasPrefix(call, "up -d") {
						started = strings.Contains(call, "tailscale-jellyfin")
						if !restoreAccess && strings.Contains(call, "tailscale-immich") {
							t.Fatalf("restarted unrelated stopped node: %s", call)
						}
					}
				}
				if !restoreAccess && started != active {
					t.Fatalf("node startup %v, Access active %v", started, active)
				}
				if !restoreAccess && started {
					net.running = append(net.running, "jellyfin", "tailscale-jellyfin")
					status, err := h.svc.Status(context.Background())
					if err != nil {
						t.Fatal(err)
					}
					for _, a := range status.Apps {
						if a.ID == "jellyfin" && a.URL != "https://jellyfin.tail1234.ts.net" {
							t.Fatalf("restored private Address = %q", a.URL)
						}
					}
				}
			})
		}
	}
}

func TestDoctorReportsUnknownPrivateAccessSafely(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(fmt.Sprint(failed), func(t *testing.T) {
			h, net := newTailnetHarness(t, "jellyfin")
			if err := h.installTailscale("jellyfin"); err != nil {
				t.Fatal(err)
			}
			net.failStatus = failed
			net.status["tailscale-jellyfin"] = "sensitive diagnostic payload"
			got := strings.Join(tailscaleChecks(t, h), "\n")
			if !strings.Contains(got, "jellyfin: private Access could not be inspected") || !strings.Contains(got, "unknown") || !strings.Contains(got, "exec -T tailscale-jellyfin") || strings.Contains(got, "sensitive diagnostic payload") {
				t.Fatalf("missing safe inspection warning: %s", got)
			}
		})
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
