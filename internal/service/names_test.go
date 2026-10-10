package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/paperlessngx"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func (h *harness) holdPort80(by string) {
	h.deps.PortFree = func(port int) bool { return port != 80 }
	if by != "" {
		h.deps.GOOS = "darwin"
		h.runner.On("lsof -nP -iTCP:80", system.Result{Stdout: []byte("p1027\nc" + by + "\n")})
	}
}

func (h *harness) ownCaddyRuns() {
	h.runner.OnFunc("docker compose", func(cmd system.Cmd) system.Result {
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

	check := h.svc.CheckEasyNames(context.Background())

	if check.Available || check.Problem != "rootless" {
		t.Fatalf("check %+v, want rootless", check)
	}
	if strings.Contains(check.Message, "setcap") || strings.Contains(check.Message, "sysctl") {
		t.Fatalf("the plain message must not hold the fix: %q", check.Message)
	}
	for _, want := range []string{"setcap cap_net_bind_service=ep $(which rootlesskit)", "net.ipv4.ip_unprivileged_port_start=80"} {
		if !strings.Contains(check.Technical, want) {
			t.Errorf("technical details lack %q: %q", want, check.Technical)
		}
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

	err := h.svc.ConfigSet(context.Background(), []string{"EASY_NAMES=on"})

	if err == nil {
		t.Fatal("rootless Docker must refuse")
	}
	plain, technical, found := strings.Cut(err.Error(), "\n\nTechnical details:\n")
	if !found || strings.Contains(plain, "setcap") || !strings.Contains(technical, "setcap") {
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
