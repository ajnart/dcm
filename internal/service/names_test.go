package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/paperlessngx"
	"github.com/ajnart/self-host/internal/apps/vaultwarden"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func (h *harness) holdPort80(by string) {
	h.deps.BindTCP = func(_, address string) error {
		if strings.HasSuffix(address, ":80") {
			return syscall.EADDRINUSE
		}
		return nil
	}
	if by != "" {
		h.deps.GOOS = "darwin"
		h.runner.On("lsof -nP -iTCP:80", system.Result{Stdout: []byte("p1027\nc" + by + "\n")})
	}
}

func (h *harness) ownCaddyRuns() {
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps --all") {
			return system.Result{Stdout: []byte(`{"Service":"access-caddy","State":"running","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":80,"Protocol":"tcp"}]}` + "\n")}
		}
		return system.Result{}
	})
}

func TestEasyNamesAreNotOfferedWhileAnotherProgramHoldsPort80(t *testing.T) {
	h := newHarness(t)
	h.holdPort80("OrbStack")

	check := h.svc.CheckEasyNames(context.Background())

	if check.Available || check.Problem != "port-held" || check.Holder != "OrbStack" {
		t.Fatalf("check %+v, want port-held by OrbStack", check)
	}
	want := "Another program (OrbStack) already uses port 80, so nothing was changed. The addresses with numbers keep working."
	if check.Message != want {
		t.Fatalf("message %q, want %q", check.Message, want)
	}
}

func TestWhenNobodyCanSayWhoHoldsPort80TheMessageStillSaysSo(t *testing.T) {
	h := newHarness(t)
	h.holdPort80("")

	check := h.svc.CheckEasyNames(context.Background())

	if want := "Port 80 is already in use or cannot be checked by binding, so nothing was changed. The addresses with numbers keep working."; check.Message != want {
		t.Fatalf("message %q, want %q", check.Message, want)
	}
}

func TestRootlessDockerKeepsHomeNetworkAndPutsTheFixUnderTechnicalDetails(t *testing.T) {
	h := newHarness(t)
	h.runner.On("docker info", system.Result{Stdout: []byte(`["name=seccomp,profile=builtin","name=rootless"]`)})
	h.deps.BindTCP = func(string, string) error { return syscall.EACCES }

	check := h.svc.CheckEasyNames(context.Background())

	if check.Available || check.Problem != "rootless" {
		t.Fatalf("check %+v, want rootless", check)
	}
	if strings.Contains(check.Message, "sysctl") {
		t.Fatalf("the plain message must not hold the fix: %q", check.Message)
	}
	for _, want := range []string{"net.ipv4.ip_unprivileged_port_start=80", "systemctl --user restart docker"} {
		if !strings.Contains(check.Technical, want) {
			t.Errorf("technical details lack %q: %q", want, check.Technical)
		}
	}
}

func TestRootlessDockerAllowsEasyNamesOnceThePortCanBeBound(t *testing.T) {
	h := newHarness(t)
	h.runner.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})

	check := h.svc.CheckEasyNames(context.Background())

	if !check.Available {
		t.Fatalf("check %+v, want available", check)
	}
}

func TestPortHeldByThisProjectsOwnCaddyIsFine(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	h.holdPort80("OrbStack")
	h.ownCaddyRuns()

	if check := h.svc.CheckEasyNames(context.Background()); !check.Available {
		t.Fatalf("our own Caddy holds the port, so names stay on: %+v", check)
	}
}

func TestAHotspotStyleAddressIsNotAHomeNetwork(t *testing.T) {
	h := newHarness(t)
	h.deps.LANIP = func() (string, error) { return "192.0.0.2", nil }

	check := h.svc.CheckEasyNames(context.Background())

	if check.Available || check.Problem != "network" || !strings.Contains(check.Message, "192.0.0.2") {
		t.Fatalf("check %+v, want a refusal that names the address", check)
	}
}

func TestAPrivatePointToPointAddressIsNotOfferedForEasyNames(t *testing.T) {
	h := newHarness(t)
	h.deps.HomeNetwork = func(string) bool { return false }
	if check := h.svc.CheckEasyNames(context.Background()); check.Available || check.Problem != "network" {
		t.Fatalf("check %+v", check)
	}
}

func TestTurningOnEasyNamesRendersTheCaddyAndAHostPerApp(t *testing.T) {
	done := map[string]bool{}
	h := newHarness(t, &testApp{id: "one", done: done}, &testApp{id: "two", done: done})
	if err := h.install("one", "two"); err != nil {
		t.Fatal(err)
	}
	before := len(h.composeCalls())

	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}

	caddyfile, err := os.ReadFile(filepath.Join(h.root(), "access", "caddy", "config", "Caddyfile"))
	if err != nil {
		t.Fatal(err)
	}
	want := `{
	admin off
	auto_https off
}

http://one.192-168-1-20.sslip.io {
	reverse_proxy one:80
}

http://two.192-168-1-20.sslip.io {
	reverse_proxy two:80
}

http://:80 {
	respond "self-host: unknown name" 404
}
`
	if string(caddyfile) != want {
		t.Fatalf("Caddyfile:\n%s\nwant:\n%s", caddyfile, want)
	}
	fragment, _ := os.ReadFile(filepath.Join(h.root(), "access", "caddy", "compose.yml"))
	if !strings.Contains(string(fragment), "access-caddy:") || !strings.Contains(string(fragment), "${BIND_IP}:80:80") {
		t.Fatalf("fragment:\n%s", fragment)
	}
	root, _ := os.ReadFile(filepath.Join(h.root(), "compose.yml"))
	if !strings.Contains(string(root), "  - access/caddy/compose.yml\n") {
		t.Fatalf("the root Compose file does not include the Caddy:\n%s", root)
	}
	settings, _ := os.ReadFile(filepath.Join(h.root(), ".env"))
	if !strings.Contains(string(settings), "EASY_NAMES=on\n") || !strings.Contains(string(settings), "EXPOSURE=lan\n") {
		t.Fatalf("settings:\n%s", settings)
	}
	assertCalls(t, h.composeCalls()[before:], []string{"up -d --remove-orphans access-caddy"})
}

func TestEasyNamesBlockedByPort80ChangeNothing(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.holdPort80("OrbStack")
	settingsBefore, _ := os.ReadFile(filepath.Join(h.root(), ".env"))
	callsBefore := len(h.runner.Calls())

	err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"})

	var blocked *NamesBlocked
	if !errors.As(err, &blocked) || blocked.Problem != "port-held" {
		t.Fatalf("error %v, want NamesBlocked port-held", err)
	}
	if !strings.HasPrefix(err.Error(), "Another program (OrbStack) already uses port 80, so nothing was changed.") {
		t.Fatalf("error %q", err)
	}
	settingsAfter, _ := os.ReadFile(filepath.Join(h.root(), ".env"))
	if string(settingsAfter) != string(settingsBefore) {
		t.Fatalf("settings changed:\n%s", settingsAfter)
	}
	if _, err := os.Stat(filepath.Join(h.root(), "access")); !os.IsNotExist(err) {
		t.Fatalf("access folder exists: %v", err)
	}
	for _, call := range h.runner.Calls()[callsBefore:] {
		if strings.Contains(call, "compose") {
			t.Fatalf("Compose ran: %s", call)
		}
	}
}

func TestEasyNamesBlockedByRootlessDockerShowTheFixOnlyAfterTechnicalDetails(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	h.runner.On("docker info", system.Result{Stdout: []byte(`["name=rootless"]`)})
	h.deps.BindTCP = func(string, string) error { return syscall.EACCES }

	err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"})

	if err == nil {
		t.Fatal("rootless Docker must refuse")
	}
	plain, technical, found := strings.Cut(err.Error(), "\n\nTechnical details:\n")
	if !found || strings.Contains(plain, "sysctl") || !strings.Contains(technical, "sysctl") {
		t.Fatalf("error %q: the fix belongs under Technical details only", err)
	}
}

func TestRerunningEasyNamesWhileTheOwnCaddyHoldsPort80IsNotAnError(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	h.holdPort80("")
	h.ownCaddyRuns()

	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatalf("second run: %v", err)
	}
}

func TestTurningOffEasyNamesRemovesTheCaddy(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	before := len(h.composeCalls())

	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=off"}); err != nil {
		t.Fatal(err)
	}

	assertCalls(t, h.composeCalls()[before:], []string{"rm --stop --force access-caddy"})
	if _, err := os.Stat(filepath.Join(h.root(), "access")); !os.IsNotExist(err) {
		t.Fatalf("access folder still there: %v", err)
	}
	root, _ := os.ReadFile(filepath.Join(h.root(), "compose.yml"))
	if strings.Contains(string(root), "access/caddy") {
		t.Fatalf("root still includes the Caddy:\n%s", root)
	}
}

func TestEasyNamesNeedTheHomeNetwork(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}

	err := h.svc.ConfigSet(context.Background(), []string{"EXPOSURE=local", "EASY_NAMES=on"})

	if err == nil || !strings.Contains(err.Error(), "Home network") {
		t.Fatalf("error %v, want a refusal that names Home network", err)
	}
}

func TestChoosingThisComputerOnlyTurnsEasyNamesOff(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}

	if err := h.svc.ConfigSet(context.Background(), []string{"EXPOSURE=local"}); err != nil {
		t.Fatal(err)
	}

	settings, _ := os.ReadFile(filepath.Join(h.root(), ".env"))
	if strings.Contains(string(settings), "EASY_NAMES=on") {
		t.Fatalf("names stayed on:\n%s", settings)
	}
	if _, err := os.Stat(filepath.Join(h.root(), "access")); !os.IsNotExist(err) {
		t.Fatalf("access folder still there: %v", err)
	}
}

func TestInstallingAndRemovingAppsKeepsTheCaddyfileInStep(t *testing.T) {
	done := map[string]bool{}
	h := newHarness(t, &testApp{id: "one", done: done}, &testApp{id: "two", done: done})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	read := func() string {
		data, _ := os.ReadFile(filepath.Join(h.root(), "access", "caddy", "config", "Caddyfile"))
		return string(data)
	}
	h.ownCaddyRuns()

	if err := h.install("two"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(read(), "http://two.192-168-1-20.sslip.io") {
		t.Fatalf("the new App has no name:\n%s", read())
	}
	calls := h.composeCalls()
	if last := calls[len(calls)-1]; last != "restart access-caddy" {
		t.Fatalf("the Caddy must pick up the new Caddyfile, last call %q", last)
	}

	if err := h.svc.Remove(context.Background(), []string{"one"}, false); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(read(), "one.192-168-1-20") {
		t.Fatalf("the removed App still has a name:\n%s", read())
	}
}

func TestANewProjectCanStartWithEasyNames(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})

	if err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, EasyNames: true}); err != nil {
		t.Fatal(err)
	}

	settings, _ := os.ReadFile(filepath.Join(h.root(), ".env"))
	if !strings.Contains(string(settings), "EASY_NAMES=on\n") {
		t.Fatalf("settings:\n%s", settings)
	}
	if got := h.composeCalls(); got[len(got)-1] != "up -d --remove-orphans access-caddy" {
		t.Fatalf("the Caddy was not started last: %v", got)
	}
}

func TestInstallWithEasyNamesWhilePort80IsTakenWritesNothing(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	h.holdPort80("OrbStack")

	err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, EasyNames: true})

	if err == nil || !strings.Contains(err.Error(), "OrbStack") {
		t.Fatalf("error %v", err)
	}
	if _, statErr := os.Stat(h.root()); !os.IsNotExist(statErr) {
		t.Fatalf("a Project was created: %v", statErr)
	}
}

func statusJSON(t *testing.T, h *harness) map[string]any {
	t.Helper()
	status, err := h.svc.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(status)
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func enabledNames(t *testing.T) *harness {
	t.Helper()
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	h.ownCaddyRuns()
	return h
}

func TestStatusListsTheNameFirstThenTheNumberedAddressAndUrlIsTheFirst(t *testing.T) {
	h := enabledNames(t)

	one := appStatus(t, h, "one")

	want := []string{"http://one.192-168-1-20.sslip.io", "http://192.168.1.20:9000"}
	if len(one.Addresses) != 2 || one.Addresses[0] != want[0] || one.Addresses[1] != want[1] {
		t.Fatalf("addresses %q, want %q", one.Addresses, want)
	}
	if one.URL != want[0] {
		t.Fatalf("url %q, want the first address %q", one.URL, want[0])
	}
	out := statusJSON(t, h)
	if access := out["access"].([]any); len(access) != 2 || access[0] != "home" || access[1] != "names" {
		t.Fatalf("access %v, want home and names", access)
	}
	if out["exposure"] != "lan" {
		t.Fatalf("exposure %v keeps its meaning", out["exposure"])
	}
	if names := out["names"].(map[string]any); names["on"] != true || names["working"] != true {
		t.Fatalf("names %v", names)
	}
}

func TestStatusListsOnlyTheNamesThatResolve(t *testing.T) {
	h := enabledNames(t)
	h.deps.Resolver = &systemtest.Resolver{Blocked: true}

	one := appStatus(t, h, "one")

	if len(one.Addresses) != 1 || one.Addresses[0] != "http://192.168.1.20:9000" || one.URL != one.Addresses[0] {
		t.Fatalf("url %q addresses %q, want only the numbered address", one.URL, one.Addresses)
	}
	names := statusJSON(t, h)["names"].(map[string]any)
	if names["working"] != false || names["problem"] != "blocked" || !strings.Contains(names["message"].(string), "Your router hides the easy names") {
		t.Fatalf("names %v", names)
	}
	if !strings.Contains(names["technical"].(string), "DNS-rebind") {
		t.Fatalf("names %v lacks the technical details", names)
	}
}

func TestStatusHasNoNamesSectionWhileEasyNamesAreOff(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	out := statusJSON(t, h)
	if _, found := out["names"]; found {
		t.Fatalf("names %v, want none", out["names"])
	}
	if access := out["access"].([]any); len(access) != 1 || access[0] != "home" {
		t.Fatalf("access %v", access)
	}
}

func TestEasyNamesFollowAChangedLANAddressAndDropOldBookmarks(t *testing.T) {
	h := enabledNames(t)
	h.deps.LANIP = func() (string, error) { return "10.0.0.7", nil }
	h.deps.HostIPs = func() ([]string, error) { return []string{"10.0.0.7"}, nil }
	if err := h.svc.ConfigSet(context.Background(), []string{"LAN_IP=10.0.0.7"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(h.root(), "access/caddy/config/Caddyfile"))
	if err != nil || strings.Contains(string(data), "192-168-1-20") || !strings.Contains(string(data), "one.10-0-0-7.sslip.io") {
		t.Fatalf("Caddyfile %s error %v", data, err)
	}
	one := appStatus(t, h, "one")
	if one.URL != "http://one.10-0-0-7.sslip.io" || one.Addresses[1] != "http://10.0.0.7:9000" {
		t.Fatalf("status %+v", one)
	}
}

func TestAnAppWithNoWebPageGetsNoNameAndNoRoute(t *testing.T) {
	h := newHarness(t, noPageApp{&testApp{id: "renovate", done: map[string]bool{}}}, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one", "renovate"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(h.root(), "access/caddy/config/Caddyfile"))
	if strings.Contains(string(data), "renovate") {
		t.Fatalf("Caddyfile %s", data)
	}
	if got := appStatus(t, h, "renovate"); got.URL != "" || len(got.Addresses) != 0 {
		t.Fatalf("no web page: %+v", got)
	}
}

type noPageApp struct{ *testApp }

func (a noPageApp) Info() app.Info {
	info := a.testApp.Info()
	info.NoWebUI = true
	return info
}

func TestHomarrInventoryUsesTheFriendliestWorkingAddress(t *testing.T) {
	dashboard := &inventoryProbeApp{testApp: &testApp{id: "homarr", done: map[string]bool{}}, inspect: true}
	h := newHarness(t, dashboard, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one", "homarr"); err != nil {
		t.Fatal(err)
	}
	h.ownCaddyRuns()
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	for _, item := range dashboard.installed {
		if item.ID == "one" && item.URL != "http://one.192-168-1-20.sslip.io" {
			t.Fatalf("tile %+v", item)
		}
	}
}

func TestInvalidEasyNamesLANAddressIsRefusedBeforeWriting(t *testing.T) {
	h := enabledNames(t)
	p, _ := h.svc.Project()
	before, _ := p.LoadSettings()
	err := h.svc.ConfigSet(context.Background(), []string{"LAN_IP=192.0.0.2"})
	if err == nil {
		t.Fatal("expected refusal")
	}
	after, _ := p.LoadSettings()
	if after["LAN_IP"] != before["LAN_IP"] {
		t.Fatal("settings changed")
	}
}

func TestEasyNamesReservePort80FromApps(t *testing.T) {
	a := &testApp{id: "one", done: map[string]bool{}}
	h := newHarness(t, a)
	err := h.svc.Install(context.Background(), InstallOptions{Targets: []string{"one"}, Sets: []string{"one.port=80"}, EasyNames: true})
	if err == nil || !strings.Contains(err.Error(), "port 80") {
		t.Fatalf("error %v", err)
	}
}

func TestChangingEasyNamesRecreatesOnlyAppsWhoseOriginsChange(t *testing.T) {
	h := newHarness(t, renderOnlyApp{paperlessngx.App{}}, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("paperless-ngx", "one"); err != nil {
		t.Fatal(err)
	}
	before := len(h.composeCalls())
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(h.root(), "apps/paperless-ngx/compose.yml"))
	if !strings.Contains(string(data), "PAPERLESS_URL: http://paperless-ngx.192-168-1-20.sslip.io") {
		t.Fatalf("fragment %s", data)
	}
	assertCalls(t, h.composeCalls()[before:], []string{"up -d --remove-orphans paperless-ngx paperless-ngx-broker paperless-ngx-db", "up -d --remove-orphans access-caddy"})
}

func TestCustomizedOriginFragmentsRefuseAccessChangesBeforeAnyWrites(t *testing.T) {
	for _, a := range []app.App{paperlessngx.App{}, vaultwarden.App{}} {
		for _, tc := range []struct {
			on    bool
			pairs []string
		}{{false, []string{"EASY_NAMES=on"}}, {true, []string{"EASY_NAMES=off"}}, {true, []string{"LAN_IP=10.0.0.7"}}} {
			h := newHarness(t, renderOnlyApp{a}, &testApp{id: "one", done: map[string]bool{}})
			if err := h.install(a.Info().ID, "one"); err != nil {
				t.Fatal(err)
			}
			if tc.on {
				if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
					t.Fatal(err)
				}
			}
			p, _ := h.svc.Project()
			file := p.FragmentPath(a.Info().ID)
			data, _ := os.ReadFile(file)
			custom := strings.Replace(string(data), a.Info().Image, "example/custom:pin", 1)
			custom = strings.Replace(custom, "    volumes:", "      CUSTOM_ENV: keep\n    volumes:\n      - ./custom:/custom", 1)
			if err := os.WriteFile(file, []byte(custom), 0644); err != nil {
				t.Fatal(err)
			}
			before, _ := p.LoadSettings()
			beforeNames, _ := os.ReadFile(p.NamesCaddyfilePath())
			err := h.svc.ConfigSet(context.Background(), tc.pairs)
			if err == nil || !strings.Contains(err.Error(), "customized") {
				t.Fatalf("error %v", err)
			}
			after, _ := p.LoadSettings()
			got, _ := os.ReadFile(file)
			afterNames, _ := os.ReadFile(p.NamesCaddyfilePath())
			if string(got) != custom || after["LAN_IP"] != before["LAN_IP"] || after["EASY_NAMES"] != before["EASY_NAMES"] || string(afterNames) != string(beforeNames) {
				t.Fatal("changed Project on refusal")
			}
		}
	}
}

func TestDownThenRemoveOrRetryDoesNotStartEasyNames(t *testing.T) {
	for _, action := range []string{"remove", "setup", "reinstall"} {
		t.Run(action, func(t *testing.T) {
			h := enabledNames(t)
			if err := h.svc.Down(context.Background()); err != nil {
				t.Fatal(err)
			}
			h.runner.On("docker compose --project-directory", system.Result{})
			before := len(h.composeCalls())
			var err error
			switch action {
			case "remove":
				err = h.svc.Remove(context.Background(), []string{"one"}, false)
			case "setup":
				err = h.svc.Setup(context.Background(), []string{"one"})
			case "reinstall":
				err = h.install("one")
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, call := range h.composeCalls()[before:] {
				if strings.Contains(call, "up ") && strings.Contains(call, "access-caddy") {
					t.Fatalf("started stopped Access: %s", call)
				}
			}
			data, _ := os.ReadFile(filepath.Join(h.root(), "access/caddy/config/Caddyfile"))
			if action == "remove" && strings.Contains(string(data), "one.") {
				t.Fatal("route retained")
			}
		})
	}
}

type accessProbeApp struct {
	*testApp
	configure int
}

func (a *accessProbeApp) ConfigureAccess(context.Context, *helpers.H) error {
	a.configure++
	return nil
}

func TestStoppedNextcloudDefersAccessConfigurationUntilExplicitStart(t *testing.T) {
	a := &accessProbeApp{testApp: &testApp{id: "nextcloud", done: map[string]bool{}}}
	h := newHarness(t, a, &testApp{id: "two", done: map[string]bool{}})
	if err := h.install("nextcloud"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.Stop(context.Background(), []string{"nextcloud"}); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	if err := h.install("two"); err != nil {
		t.Fatal(err)
	}
	if a.configure != 0 {
		t.Fatalf("configured stopped Nextcloud %d times", a.configure)
	}
	h.runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if strings.Contains(systemtest.Line(cmd), " ps --all") {
			return system.Result{Stdout: []byte(`{"Service":"nextcloud","State":"running"}`)}
		}
		return system.Result{}
	})
	if err := h.svc.Start(context.Background(), []string{"nextcloud"}); err != nil {
		t.Fatal(err)
	}
	if a.configure != 1 {
		t.Fatalf("pending Access not configured: %d", a.configure)
	}
}

func TestNamesFallBackWhenCaddyStopsOrLANChangesDespiteWorkingDNS(t *testing.T) {
	for _, problem := range []string{"binding", "down", "configuration", "lan-changed", "lan-unavailable"} {
		h := enabledNames(t)
		h.ownCaddyRuns()
		if problem == "binding" {
			h.runner.On("docker compose --project-directory", system.Result{})
		} else if problem == "down" {
			if err := h.svc.Down(context.Background()); err != nil {
				t.Fatal(err)
			}
			h.runner.On("docker compose --project-directory", system.Result{})
		} else if problem == "configuration" {
			if err := os.WriteFile(filepath.Join(h.root(), "access/caddy/config/Caddyfile"), []byte("old configuration"), 0644); err != nil {
				t.Fatal(err)
			}
		} else if problem == "lan-changed" {
			h.deps.LANIP = func() (string, error) { return "10.0.0.7", nil }
			h.deps.HostIPs = func() ([]string, error) { return []string{"10.0.0.7"}, nil }
		} else {
			h.deps.LANIP = func() (string, error) { return "", errors.New("unavailable") }
			h.deps.HostIPs = func() ([]string, error) { return nil, errors.New("unavailable") }
		}
		status, err := h.svc.Status(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		want := problem
		if problem == "down" {
			want = "binding"
		}
		if problem == "configuration" {
			want = "pending"
		}
		if status.Names.Working || status.Names.Problem != want || status.Apps[0].URL != "http://192.168.1.20:9000" || len(status.Apps[0].Addresses) != 1 {
			t.Fatalf("status %+v", status)
		}
	}
}

func TestHomarrInventoryKeepsNumberedAddressesWhenCaddyIsUnavailable(t *testing.T) {
	dashboard := &inventoryProbeApp{testApp: &testApp{id: "homarr", done: map[string]bool{}}, inspect: true}
	h := newHarness(t, dashboard, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one", "homarr"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	for _, item := range dashboard.installed {
		if item.ID == "one" && item.URL != "http://192.168.1.20:9000" {
			t.Fatalf("tile %+v", item)
		}
	}
}

func TestQueuedLANChangeRevalidatesNamesEnabledByTheLockOwner(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	inspecting, release, waiting := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var inspected sync.Once
	h.deps.BindTCP = func(_, address string) error {
		if strings.HasSuffix(address, ":80") {
			inspected.Do(func() { close(inspecting); <-release })
		}
		return nil
	}
	ctx := &queuedNamesContext{Context: context.Background(), entered: waiting}
	enabled, invalid := make(chan error, 1), make(chan error, 1)
	go func() { enabled <- h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}) }()
	<-inspecting
	go func() { invalid <- h.svc.ConfigSet(ctx, []string{"LAN_IP=192.0.0.2"}) }()
	<-waiting
	close(release)
	if err := <-enabled; err != nil {
		t.Fatal(err)
	}
	if err := <-invalid; err == nil {
		t.Fatal("queued invalid LAN change succeeded")
	}
	p, _ := h.svc.Project()
	settings, _ := p.LoadSettings()
	if settings["EASY_NAMES"] != "on" || settings["LAN_IP"] != "192.168.1.20" {
		t.Fatalf("settings %v", settings)
	}
}

type queuedNamesContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (c *queuedNamesContext) Done() <-chan struct{} {
	c.once.Do(func() { close(c.entered) })
	return c.Context.Done()
}

func TestRestoreRebuildsNamesWithoutSetupAndRejectsPortConflictBeforeReplacement(t *testing.T) {
	for _, fresh := range []bool{true, false} {
		t.Run(fmt.Sprint(fresh), func(t *testing.T) {
			source := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "two", done: map[string]bool{}})
			if err := source.install("one", "two"); err != nil {
				t.Fatal(err)
			}
			if err := source.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
				t.Fatal(err)
			}
			file, err := source.svc.Backup(context.Background(), nil, filepath.Join(t.TempDir(), "names.tar.zst"), "")
			if err != nil {
				t.Fatal(err)
			}
			h := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "two", done: map[string]bool{}})
			var targets []string
			if !fresh {
				targets = []string{"one"}
			}
			if !fresh {
				if err := h.install("one"); err != nil {
					t.Fatal(err)
				}
				if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(h.root(), "apps/one/marker"), []byte("preserve"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			h.holdPort80("occupied")
			beforeRefusal := len(h.composeCalls())
			if err := h.svc.Restore(context.Background(), file, targets, ""); err == nil {
				t.Fatal("restore accepted port conflict")
			}
			if len(h.composeCalls()) != beforeRefusal {
				t.Fatal("Restore mutated containers on preflight refusal")
			}
			p, _ := h.svc.Project()
			if fresh && p.Exists() {
				t.Fatal("fresh Project initialized on refusal")
			}
			if !fresh {
				data, _ := os.ReadFile(filepath.Join(h.root(), "apps/one/marker"))
				if string(data) != "preserve" {
					t.Fatal("data replaced on refusal")
				}
			}
			h.deps.BindTCP = func(string, string) error { return nil }
			if !fresh {
				if err := h.svc.Remove(context.Background(), []string{"one"}, false); err != nil {
					t.Fatal(err)
				}
			}
			beforeRestore := len(h.composeCalls())
			if err := h.svc.Restore(context.Background(), file, targets, ""); err != nil {
				t.Fatal(err)
			}
			startedNames := false
			for _, call := range h.composeCalls()[beforeRestore:] {
				if strings.HasPrefix(call, "up ") && strings.Contains(call, "access-caddy") {
					startedNames = true
				}
			}
			if startedNames != fresh {
				t.Fatalf("Restore started Access=%v, fresh Project=%v", startedNames, fresh)
			}
			data, _ := os.ReadFile(p.NamesCaddyfilePath())
			if !strings.Contains(string(data), "one.192-168-1-20.sslip.io") || !p.HasNames() {
				t.Fatalf("routes %s", data)
			}
			if e := h.rec.find("one", "configure"); fresh && e != nil {
				t.Fatal("Restore reran Setup")
			}
		})
	}
}

func TestDoctorExplainsBlockedEasyNamesInPlainWords(t *testing.T) {
	h := enabledNames(t)
	h.deps.Resolver = &systemtest.Resolver{Blocked: true}
	for _, check := range h.svc.Doctor(context.Background()) {
		if check.ID == "easy-names" {
			if !strings.Contains(check.Detail, "Your router hides the easy names") {
				t.Fatalf("check %+v", check)
			}
			return
		}
	}
	t.Fatal("no Easy names check")
}

func TestInstallIntoNamesProjectRefusesPortConflictBeforeAddingAnApp(t *testing.T) {
	h := newHarness(t, &testApp{id: "one", done: map[string]bool{}}, &testApp{id: "two", done: map[string]bool{}})
	if err := h.install("one"); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"}); err != nil {
		t.Fatal(err)
	}
	h.holdPort80("another program")
	before := len(h.composeCalls())
	if err := h.install("two"); err == nil {
		t.Fatal("expected refusal")
	}
	if _, err := os.Stat(filepath.Join(h.root(), "apps/two/compose.yml")); !os.IsNotExist(err) {
		t.Fatalf("App was added: %v", err)
	}
	for _, call := range h.composeCalls()[before:] {
		if !strings.HasPrefix(call, "ps ") {
			t.Fatalf("Compose mutation ran: %s", call)
		}
	}
}
