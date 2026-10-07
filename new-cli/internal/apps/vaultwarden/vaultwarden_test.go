package vaultwarden_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/vaultwarden"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fakeVaultwarden models the parts of Vaultwarden that Setup and Check use.
// Like the real container it takes ADMIN_TOKEN once, when it is started.
type fakeVaultwarden struct {
	mu             sync.Mutex
	token          string
	signupsAllowed bool
	// logins counts attempts in the rate-limit window; the real default is 3
	// per ADMIN_RATELIMIT_SECONDS=300.
	logins     int
	loginLimit int
	// noConfig makes the diagnostics endpoint answer 404, like a version without it.
	noConfig bool
}

func (f *fakeVaultwarden) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /alive", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`"2026-10-06T12:00:00Z"`))
	})
	mux.HandleFunc("POST /admin", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.logins++
		if f.logins > f.loginLimit {
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte("<html>Too many requests</html>"))
			return
		}
		r.ParseForm()
		if f.token == "" || r.PostForm.Get("token") != f.token {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("<html>Invalid admin token</html>"))
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "VW_ADMIN", Value: "jwt-for-" + f.token, Path: "/admin"})
		if redirect := r.PostForm.Get("redirect"); redirect != "" {
			http.Redirect(w, r, "/"+redirect, http.StatusSeeOther)
			return
		}
		w.Write([]byte("<html>Admin panel</html>"))
	})
	mux.HandleFunc("GET /admin/diagnostics/config", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.noConfig {
			http.NotFound(w, r)
			return
		}
		cookie, err := r.Cookie("VW_ADMIN")
		if err != nil || cookie.Value != "jwt-for-"+f.token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"signups_allowed": f.signupsAllowed, "domain": "http://192.168.1.20"})
	})
	return mux
}

// upRecord captures what the container would read when Compose starts it.
type upRecord struct {
	secretsAtUp string
}

func setup(t *testing.T) (*system.Deps, *fakeVaultwarden, *upRecord, *httptest.Server, *catalog.Catalog) {
	fake := &fakeVaultwarden{loginLimit: 3}
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
	deps := systemtest.NewDeps(t)
	record := &upRecord{}
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		if !strings.Contains(systemtest.Line(cmd), " up -d") {
			return system.Result{}
		}
		record.secretsAtUp = clitest.Read(t, filepath.Join(clitest.Root(t, deps), "secrets.env"))
		fake.mu.Lock()
		defer fake.mu.Unlock()
		for _, line := range strings.Split(record.secretsAtUp, "\n") {
			if value, found := strings.CutPrefix(line, "VAULTWARDEN_ADMIN_TOKEN="); found {
				fake.token = value
			}
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{vaultwarden.App{}}, nil)
	return deps, fake, record, server, cat
}

type credentials struct {
	Apps map[string]map[string]string
}

func readCredentials(t *testing.T, deps *system.Deps, cat *catalog.Catalog) credentials {
	t.Helper()
	r := clitest.Run(t, deps, cat, "credentials", "--json")
	var creds credentials
	if err := json.Unmarshal([]byte(r.Out), &creds); err != nil {
		t.Fatalf("credentials output: %v\n%s", err, r.Out)
	}
	return creds
}

func TestInstallGeneratesAdminTokenBeforeTheContainerStarts(t *testing.T) {
	deps, fake, record, server, cat := setup(t)

	r := clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--json", "--set", "vaultwarden.port="+clitest.Port(server))

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	if !strings.Contains(record.secretsAtUp, "VAULTWARDEN_ADMIN_TOKEN=") {
		t.Fatalf("secrets.env had no admin token when Compose started the container:\n%s", record.secretsAtUp)
	}
	token := readCredentials(t, deps, cat).Apps["vaultwarden"]["VAULTWARDEN_ADMIN_TOKEN"]
	if len(token) < 32 || fake.token != token {
		t.Fatalf("credentials token %q does not match the one the container started with %q", token, fake.token)
	}
	fragment := clitest.Read(t, filepath.Join(clitest.Root(t, deps), "apps", "vaultwarden", "compose.yml"))
	for _, want := range []string{
		"image: vaultwarden/server:latest",
		"ADMIN_TOKEN: ${VAULTWARDEN_ADMIN_TOKEN}",
		`SIGNUPS_ALLOWED: "false"`,
		"DOMAIN: http://${LAN_IP}:" + clitest.Port(server),
		"user: ${PUID}:${PGID}",
		"TZ: ${TZ}",
		"./data:/data",
		"${BIND_IP}:" + clitest.Port(server) + ":80",
	} {
		if !strings.Contains(fragment, want) {
			t.Errorf("fragment lacks %q:\n%s", want, fragment)
		}
	}
	// The token reached the container at the first start, so nothing is left to do.
	if r.StepEvent("vaultwarden", "admin-access") != "step.skip" || r.StepEvent("vaultwarden", "check") != "step.ok" {
		t.Errorf("want admin-access skipped and check ok:\n%s", r.Out)
	}
}

func TestInstallTellsTheHumanHowToCreateTheFirstAccount(t *testing.T) {
	deps, _, _, server, cat := setup(t)

	r := clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--json", "--set", "vaultwarden.port="+clitest.Port(server))

	found := false
	for _, e := range r.Events {
		msg, _ := e["msg"].(string)
		if e["event"] == "info" && e["app"] == "vaultwarden" && strings.Contains(msg, "/admin") && strings.Contains(msg, "Invite user") && strings.Contains(msg, "self-host credentials") &&
			strings.Contains(msg, "HTTPS") && strings.Contains(msg, "ssh -L "+clitest.Port(server)+":localhost:"+clitest.Port(server)) {
			found = true
		}
	}
	if !found {
		t.Fatalf("no info event explaining how to invite the first user:\n%s", r.Out)
	}
}

func TestRerunKeepsTheTokenAndSkipsAdminAccess(t *testing.T) {
	deps, _, _, server, cat := setup(t)
	clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--set", "vaultwarden.port="+clitest.Port(server))
	before := readCredentials(t, deps, cat).Apps["vaultwarden"]["VAULTWARDEN_ADMIN_TOKEN"]

	again := clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--json")
	setupRun := clitest.Run(t, deps, cat, "setup", "vaultwarden", "--json")

	after := readCredentials(t, deps, cat).Apps["vaultwarden"]["VAULTWARDEN_ADMIN_TOKEN"]
	if before == "" || before != after {
		t.Fatalf("token changed on rerun: %q -> %q", before, after)
	}
	for name, r := range map[string]clitest.Result{"install": again, "setup": setupRun} {
		if r.Code != 0 || r.StepEvent("vaultwarden", "admin-access") != "step.skip" {
			t.Errorf("%s rerun: exit %d, admin-access should skip:\n%s", name, r.Code, r.Out)
		}
	}
}

func TestAStaleTokenFailsAdminAccessWithARecreateHint(t *testing.T) {
	deps, fake, _, server, cat := setup(t)
	clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--set", "vaultwarden.port="+clitest.Port(server))
	fake.token = "token-the-container-was-started-with"

	r := clitest.Run(t, deps, cat, "setup", "vaultwarden", "--json")

	if r.Code != 2 {
		t.Fatalf("exit %d, want 2\n%s", r.Code, r.Out)
	}
	fail := r.Step("vaultwarden", "admin-access")
	if fail == nil || fail["event"] != "step.fail" {
		t.Fatalf("admin-access should fail:\n%s", r.Out)
	}
	hint, _ := fail["hint"].(string)
	if !strings.Contains(hint, "self-host start vaultwarden") {
		t.Errorf("hint should say to recreate the container, got %q", hint)
	}
}

func TestOpenSignupsFailTheCheck(t *testing.T) {
	deps, fake, _, server, cat := setup(t)
	clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--set", "vaultwarden.port="+clitest.Port(server))
	fake.signupsAllowed = true

	r := clitest.Run(t, deps, cat, "setup", "vaultwarden", "--json")

	if r.Code != 2 {
		t.Fatalf("exit %d, want 2\n%s", r.Code, r.Out)
	}
	fail := r.Step("vaultwarden", "check")
	if fail == nil || fail["event"] != "step.fail" || !strings.Contains(fail["error"].(string), "signups") {
		t.Fatalf("check should fail on open signups:\n%s", r.Out)
	}
}

func TestACheckThatCannotReadTheConfigFails(t *testing.T) {
	deps, fake, _, server, cat := setup(t)
	fake.noConfig = true

	r := clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--json", "--set", "vaultwarden.port="+clitest.Port(server))

	if r.Code != 2 || r.StepEvent("vaultwarden", "check") != "step.fail" {
		t.Fatalf("check should fail when the config endpoint answers 404 (exit %d):\n%s", r.Code, r.Out)
	}
}

func TestInstallAndSetupRerunsStayUnderTheLoginRateLimit(t *testing.T) {
	deps, fake, _, server, cat := setup(t)

	runs := []clitest.Result{
		clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--json", "--set", "vaultwarden.port="+clitest.Port(server)),
		clitest.Run(t, deps, cat, "setup", "vaultwarden", "--json"),
		clitest.Run(t, deps, cat, "setup", "vaultwarden", "--json"),
	}

	for i, r := range runs {
		if r.Code != 0 {
			t.Errorf("run %d: exit %d\n%s", i, r.Code, r.Out)
		}
	}
	if fake.logins != 3 {
		t.Errorf("want one admin login per run, got %d for 3 runs", fake.logins)
	}
}

func TestARateLimitedLoginIsNotBlamedOnTheToken(t *testing.T) {
	deps, fake, _, server, cat := setup(t)
	clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--set", "vaultwarden.port="+clitest.Port(server))
	fake.logins = fake.loginLimit

	r := clitest.Run(t, deps, cat, "setup", "vaultwarden", "--json")

	if r.Code != 2 {
		t.Fatalf("exit %d, want 2\n%s", r.Code, r.Out)
	}
	fail := r.Step("vaultwarden", "admin-access")
	if fail == nil || fail["event"] != "step.fail" {
		t.Fatalf("admin-access should fail:\n%s", r.Out)
	}
	hint, _ := fail["hint"].(string)
	if !strings.Contains(hint, "wait about 5 minutes") || !strings.Contains(hint, "self-host setup vaultwarden") || strings.Contains(hint, "self-host start") {
		t.Errorf("hint should say to wait and rerun setup, got %q", hint)
	}
	if strings.Contains(fail["error"].(string), "rejected") {
		t.Errorf("error blames the token: %v", fail["error"])
	}
}

func TestTheTokenNeverAppearsInEvents(t *testing.T) {
	deps, fake, _, server, cat := setup(t)

	r := clitest.Run(t, deps, cat, "install", "vaultwarden", "--yes", "--json", "--set", "vaultwarden.port="+clitest.Port(server))

	if fake.token == "" || strings.Contains(r.Out, fake.token) {
		t.Fatalf("token %q leaked into the output:\n%s", fake.token, r.Out)
	}
}
