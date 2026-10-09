package beszel_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/beszel"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
	"go.yaml.in/yaml/v3"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
	hubKey    = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHubPublicKeyForTests"
	session   = "session-token"
)

type fakeBeszel struct {
	mu       sync.Mutex
	firstRun bool
	email    string
	password string
	key      string
	// permanent is the user's permanent universal token, "" when there is none.
	permanent string
	// enables counts requests that created a permanent token.
	enables int
	// systems maps a system name to its status.
	systems map[string]string
}

func (f *fakeBeszel) addSystem(name, status string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.systems == nil {
		f.systems = map[string]string{}
	}
	f.systems[name] = status
}

func (f *fakeBeszel) setKey(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.key = key
}

func (f *fakeBeszel) setPermanent(token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.permanent = token
}

func (f *fakeBeszel) dropSystems() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.systems = nil
}

func (f *fakeBeszel) permanentToken() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.permanent
}

func (f *fakeBeszel) enableCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.enables
}

func authorized(w http.ResponseWriter, r *http.Request) bool {
	if r.Header.Get("Authorization") != session {
		w.WriteHeader(http.StatusUnauthorized)
		return false
	}
	return true
}

func (f *fakeBeszel) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{}`)) })
	mux.HandleFunc("GET /api/beszel/first-run", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"firstRun": f.firstRun})
	})
	mux.HandleFunc("POST /api/beszel/create-user", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.firstRun, f.email, f.password = false, body.Email, body.Password
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /api/collections/users/auth-with-password", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct {
			Identity string `json:"identity"`
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Identity != f.email || body.Password != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"token":  session,
			"record": map[string]any{"email": f.email, "role": "admin"},
		})
	})
	mux.HandleFunc("GET /api/beszel/info", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(w, r) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"key": f.key, "v": "0.20.0", "cu": false})
	})
	mux.HandleFunc("GET /api/beszel/universal-token", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(w, r) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		query := r.URL.Query()
		if query.Get("enable") == "1" && query.Get("permanent") == "1" {
			f.enables++
			f.permanent = "permanent-token-created-by-the-hub"
			json.NewEncoder(w).Encode(map[string]any{"token": f.permanent, "active": true, "permanent": true})
			return
		}
		if f.permanent != "" {
			json.NewEncoder(w).Encode(map[string]any{"token": f.permanent, "active": true, "permanent": true})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"token": "ephemeral-suggestion", "active": false, "permanent": false})
	})
	mux.HandleFunc("GET /api/collections/systems/records", func(w http.ResponseWriter, r *http.Request) {
		if !authorized(w, r) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		items := []map[string]string{}
		for name, status := range f.systems {
			items = append(items, map[string]string{"id": "id-" + strings.ReplaceAll(name, " ", "-"), "name": name, "status": status})
		}
		json.NewEncoder(w).Encode(map[string]any{"page": 1, "perPage": 500, "totalItems": len(items), "items": items})
	})
	return mux
}

// fakeExec stands in for Compose: starting the agent makes it connect to the
// hub, like the real agent does with the key and token it was started with.
type fakeExec struct {
	mu       sync.Mutex
	ups      [][]string
	onUp     func(services []string)
	upFailed error
}

func (f *fakeExec) Exec(context.Context, string, map[string]string, ...string) (system.Result, error) {
	return system.Result{}, nil
}
func (*fakeExec) LogText(context.Context, int, ...string) (string, error) { return "", nil }
func (*fakeExec) Restart(context.Context, ...string) error                { return nil }

func (f *fakeExec) Up(_ context.Context, services ...string) error {
	f.mu.Lock()
	f.ups = append(f.ups, services)
	onUp, failed := f.onUp, f.upFailed
	f.mu.Unlock()
	if failed != nil {
		return failed
	}
	if onUp != nil {
		onUp(services)
	}
	return nil
}

func (f *fakeExec) upCalls() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]string(nil), f.ups...)
}

type env struct {
	fake    *fakeBeszel
	exec    *fakeExec
	secrets fakeSecrets
	events  *captured
	records []helpers.StepResult
	h       *helpers.H
}

type captured struct {
	mu     sync.Mutex
	events []events.Event
}

func (c *captured) Emit(e events.Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, e)
}

func newEnv(t *testing.T, fake *fakeBeszel) *env {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	e := &env{fake: fake, exec: &fakeExec{}, events: &captured{},
		secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass}}
	e.exec.onUp = func(services []string) {
		for _, name := range services {
			if name == beszel.AgentService && e.secrets["BESZEL_AGENT_KEY"] == fake.key && e.secrets["BESZEL_AGENT_TOKEN"] == fake.permanentToken() && fake.permanentToken() != "" {
				fake.addSystem(beszel.SystemName, "up")
			}
		}
	}
	deps := systemtest.NewDeps(t)
	e.h = helpers.New(helpers.Config{
		App: "beszel", Service: "beszel",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: e.secrets, Exec: e.exec,
		Log: events.New(e.events), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { e.records = append(e.records, r) },
	})
	return e
}

func (e *env) step(id string) (helpers.StepResult, bool) {
	var found helpers.StepResult
	ok := false
	for _, r := range e.records {
		if r.ID == id {
			found, ok = r, true
		}
	}
	return found, ok
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeBeszel{firstRun: true, key: hubKey}
	e := newEnv(t, fake)
	ctx := context.Background()

	if err := (beszel.App{}).Setup(ctx, e.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if fake.email != adminUser+"@selfhost.local" || fake.password != adminPass {
		t.Fatalf("Setup did not create the Admin login: %+v", fake)
	}
	if err := (beszel.App{}).Check(ctx, e.h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	e.records = nil
	if err := (beszel.App{}).Setup(ctx, e.h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	if len(e.records) == 0 {
		t.Fatal("rerun recorded no steps")
	}
	for _, r := range e.records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if len(e.exec.upCalls()) != 1 {
		t.Errorf("the agent was started %d times, want once", len(e.exec.upCalls()))
	}
}

func TestFailingStepHintNamesTheEmailAndSetupCommand(t *testing.T) {
	fake := &fakeBeszel{firstRun: false, key: hubKey}
	e := newEnv(t, fake)

	if err := (beszel.App{}).Setup(context.Background(), e.h); err == nil {
		t.Fatal("Setup should fail when a Hub owner already exists")
	}
	var hint string
	for _, r := range e.records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, adminUser+"@selfhost.local") || !strings.Contains(hint, "self-host setup beszel") {
		t.Errorf("hint should name the email and setup command, got %q", hint)
	}
}

func TestSetupStoresTheHubKeyAndANewPermanentTokenThenStartsTheAgent(t *testing.T) {
	fake := &fakeBeszel{firstRun: true, key: hubKey}
	e := newEnv(t, fake)
	var storedBeforeStart [2]string
	start := e.exec.onUp
	e.exec.onUp = func(services []string) {
		storedBeforeStart = [2]string{e.secrets["BESZEL_AGENT_KEY"], e.secrets["BESZEL_AGENT_TOKEN"]}
		start(services)
	}

	if err := (beszel.App{}).Setup(context.Background(), e.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if e.secrets["BESZEL_AGENT_KEY"] != hubKey {
		t.Errorf("stored key = %q, want the Hub's public key", e.secrets["BESZEL_AGENT_KEY"])
	}
	if e.secrets["BESZEL_AGENT_TOKEN"] != "permanent-token-created-by-the-hub" || fake.enableCount() != 1 {
		t.Errorf("stored token = %q after %d enable requests, want the Hub's new permanent token after one",
			e.secrets["BESZEL_AGENT_TOKEN"], fake.enableCount())
	}
	if storedBeforeStart != [2]string{hubKey, "permanent-token-created-by-the-hub"} {
		t.Error("the agent was started before its key and token were stored")
	}
	ups := e.exec.upCalls()
	if len(ups) != 1 || len(ups[0]) != 1 || ups[0][0] != "beszel-agent" {
		t.Errorf("started services = %v, want only beszel-agent", ups)
	}
	if status := fake.systems["This machine"]; status != "up" {
		t.Errorf("this machine is %q in the Hub, want up", status)
	}
}

func TestMachineIDIsThisMachinesRecordIDInTheHub(t *testing.T) {
	fake := &fakeBeszel{firstRun: true, key: hubKey}
	e := newEnv(t, fake)
	if err := (beszel.App{}).Setup(context.Background(), e.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	fake.addSystem("Another box", "up")

	id, err := beszel.MachineID(context.Background(), e.h)
	if err != nil {
		t.Fatalf("MachineID: %v", err)
	}
	if id != "id-This-machine" {
		t.Errorf("MachineID = %q, want id-This-machine", id)
	}
}

func TestSetupKeepsAnExistingPermanentTokenInsteadOfRotatingIt(t *testing.T) {
	fake := &fakeBeszel{firstRun: true, key: hubKey, permanent: "token-shared-with-other-agents"}
	e := newEnv(t, fake)

	if err := (beszel.App{}).Setup(context.Background(), e.h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if e.secrets["BESZEL_AGENT_TOKEN"] != "token-shared-with-other-agents" {
		t.Errorf("stored token = %q, want the Hub's existing permanent token", e.secrets["BESZEL_AGENT_TOKEN"])
	}
	if fake.enableCount() != 0 {
		t.Error("an existing permanent token was replaced, which would disconnect the agents using it")
	}
}

func TestSetupFailsWhenThisMachineNeverAppears(t *testing.T) {
	fake := &fakeBeszel{firstRun: true, key: hubKey}
	e := newEnv(t, fake)
	e.exec.onUp = nil

	err := (beszel.App{}).Setup(context.Background(), e.h)
	if err == nil {
		t.Fatal("Setup succeeded although the agent never connected")
	}
	r, ok := e.step("agent")
	if !ok || r.Status != stepstatus.StepFail {
		t.Fatalf("agent step = %+v, want a failure", r)
	}
	if !strings.Contains(r.Hint, "self-host logs beszel") {
		t.Errorf("hint should name how to read the agent's logs, got %q", r.Hint)
	}
}

func TestSetupFailsWhenTheAgentCannotBeStarted(t *testing.T) {
	fake := &fakeBeszel{firstRun: true, key: hubKey}
	e := newEnv(t, fake)
	e.exec.upFailed = context.DeadlineExceeded

	if err := (beszel.App{}).Setup(context.Background(), e.h); err == nil {
		t.Fatal("Setup succeeded although the agent could not start")
	}
	if r, _ := e.step("agent"); r.Status != stepstatus.StepFail {
		t.Fatalf("agent step = %+v, want a failure", r)
	}
}

func TestEveryCheckProbesAfresh(t *testing.T) {
	ctx := context.Background()
	setup := func(t *testing.T) *env {
		t.Helper()
		e := newEnv(t, &fakeBeszel{firstRun: true, key: hubKey})
		if err := (beszel.App{}).Setup(ctx, e.h); err != nil {
			t.Fatalf("Setup: %v", err)
		}
		e.records = nil
		return e
	}
	t.Run("a system that disappears from the Hub is noticed", func(t *testing.T) {
		e := setup(t)
		e.fake.dropSystems()
		if err := (beszel.App{}).Check(ctx, e.h); err == nil {
			t.Error("Check passed although this machine is no longer listed")
		}
	})
	t.Run("an agent that went down is started again", func(t *testing.T) {
		e := setup(t)
		e.fake.addSystem(beszel.SystemName, "down")
		if err := (beszel.App{}).Setup(ctx, e.h); err != nil {
			t.Fatalf("rerun Setup: %v", err)
		}
		if r, _ := e.step("agent"); r.Status != stepstatus.StepOK {
			t.Errorf("agent step = %s, want ok after starting it again", r.Status)
		}
		if len(e.exec.upCalls()) != 2 {
			t.Errorf("agent started %d times, want twice", len(e.exec.upCalls()))
		}
	})
	t.Run("a token the Hub replaced is stored again", func(t *testing.T) {
		e := setup(t)
		e.fake.setPermanent("token-the-user-regenerated")
		if err := (beszel.App{}).Setup(ctx, e.h); err != nil {
			t.Fatalf("rerun Setup: %v", err)
		}
		if r, _ := e.step("agent-settings"); r.Status != stepstatus.StepOK {
			t.Errorf("agent-settings step = %s, want ok", r.Status)
		}
		if e.secrets["BESZEL_AGENT_TOKEN"] != "token-the-user-regenerated" {
			t.Error("the stored token still differs from the Hub's")
		}
	})
	t.Run("a key the Hub replaced is stored again", func(t *testing.T) {
		e := setup(t)
		e.fake.setKey("ssh-ed25519 AAAAreplacedKey")
		if err := (beszel.App{}).Setup(ctx, e.h); err != nil {
			t.Fatalf("rerun Setup: %v", err)
		}
		if e.secrets["BESZEL_AGENT_KEY"] != "ssh-ed25519 AAAAreplacedKey" {
			t.Error("the stored key still differs from the Hub's")
		}
	})
}

func TestTheKeyAndTokenNeverReachEventsOrStepResults(t *testing.T) {
	for name, hub := range map[string]*fakeBeszel{
		"success": {firstRun: true, key: hubKey},
		"failure": {firstRun: true, key: hubKey},
	} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t, hub)
			if name == "failure" {
				e.exec.onUp = nil
			}
			(beszel.App{}).Setup(context.Background(), e.h)
			(beszel.App{}).Check(context.Background(), e.h)

			var seen strings.Builder
			e.events.mu.Lock()
			encoded, _ := json.Marshal(e.events.events)
			e.events.mu.Unlock()
			seen.Write(encoded)
			encoded, _ = json.Marshal(e.records)
			seen.Write(encoded)
			for _, secret := range []string{hubKey, "permanent-token-created-by-the-hub"} {
				if strings.Contains(seen.String(), secret) {
					t.Fatalf("a credential reached the events or step results: %.60s", seen.String())
				}
			}
		})
	}
}

type service struct {
	Image       string            `yaml:"image"`
	NetworkMode string            `yaml:"network_mode"`
	Environment map[string]string `yaml:"environment"`
	Volumes     []string          `yaml:"volumes"`
	Ports       []string          `yaml:"ports"`
	ReadOnly    bool              `yaml:"read_only"`
}

func fragment(t *testing.T) (string, map[string]service) {
	t.Helper()
	source := (beszel.App{}).Compose(app.RenderContext{Port: 8090})
	var doc struct {
		Services map[string]service `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(source), &doc); err != nil {
		t.Fatalf("fragment is not YAML: %v", err)
	}
	return source, doc.Services
}

func TestFragmentHasHubAgentAndProxyAndOnlyTheProxyMountsTheSocket(t *testing.T) {
	_, services := fragment(t)
	if len(services) != 3 || services["beszel"].Image == "" || services["beszel-agent"].Image == "" || services["beszel-socket-proxy"].Image == "" {
		t.Fatalf("services = %v, want the hub, the agent and the socket proxy", services)
	}
	for name, svc := range services {
		for _, volume := range svc.Volumes {
			if !strings.Contains(volume, "docker.sock") {
				continue
			}
			if name != beszel.SocketProxyService || volume != beszel.DockerSocketMount {
				t.Errorf("%s mounts %s; only %s may mount %s", name, volume, beszel.SocketProxyService, beszel.DockerSocketMount)
			}
		}
	}
	if got := services["beszel-socket-proxy"].Volumes; len(got) != 1 || got[0] != "/var/run/docker.sock:/var/run/docker.sock:ro" {
		t.Errorf("proxy volumes = %v, want exactly the read-only socket", got)
	}
}

func TestAgentRunsTheHubsVersion(t *testing.T) {
	_, services := fragment(t)
	hub, agent := services["beszel"].Image, services["beszel-agent"].Image
	if hub != "henrygd/beszel:0.20.0" || agent != "henrygd/beszel-agent:0.20.0" {
		t.Errorf("hub %q and agent %q should both be 0.20.0", hub, agent)
	}
}

func TestProxyAllowsContainerReadsAndDeniesWrites(t *testing.T) {
	_, services := fragment(t)
	proxy := services["beszel-socket-proxy"]
	if proxy.Environment["CONTAINERS"] != "1" || proxy.Environment["POST"] != "0" {
		t.Errorf("proxy environment = %v, want CONTAINERS=1 and POST=0", proxy.Environment)
	}
	for _, denied := range []string{"EXEC", "IMAGES", "VOLUMES", "NETWORKS", "ALLOW_LOGS", "ALLOW_START", "ALLOW_STOP", "ALLOW_RESTARTS"} {
		if value, set := proxy.Environment[denied]; set && value != "0" {
			t.Errorf("proxy enables %s=%s", denied, value)
		}
	}
	if !proxy.ReadOnly {
		t.Error("proxy root filesystem should be read-only")
	}
}

func TestAgentListensOnLoopbackAndTheProxyIsPublishedOnLoopbackWhateverTheExposure(t *testing.T) {
	source, services := fragment(t)
	agent, proxy := services["beszel-agent"], services["beszel-socket-proxy"]
	if agent.NetworkMode != "host" {
		t.Errorf("agent network_mode = %q, want host", agent.NetworkMode)
	}
	if agent.Environment["LISTEN"] != "127.0.0.1:45876" {
		t.Errorf("agent LISTEN = %q, want 127.0.0.1:45876", agent.Environment["LISTEN"])
	}
	if agent.Environment["HUB_URL"] != "http://127.0.0.1:8090" {
		t.Errorf("agent HUB_URL = %q, want the hub on 127.0.0.1", agent.Environment["HUB_URL"])
	}
	if agent.Environment["DOCKER_HOST"] != "tcp://127.0.0.1:45877" {
		t.Errorf("agent DOCKER_HOST = %q, want the proxy on 127.0.0.1", agent.Environment["DOCKER_HOST"])
	}
	if len(agent.Ports) != 0 {
		t.Errorf("a host-network agent publishes no ports, got %v", agent.Ports)
	}
	if len(proxy.Ports) != 1 || proxy.Ports[0] != "127.0.0.1:45877:2375" {
		t.Errorf("proxy ports = %v, want only 127.0.0.1:45877:2375", proxy.Ports)
	}
	for _, exposure := range []string{"0.0.0.0", "127.0.0.1"} {
		rendered := strings.ReplaceAll(source, "${BIND_IP}", exposure)
		var doc struct {
			Services map[string]service `yaml:"services"`
		}
		if err := yaml.Unmarshal([]byte(rendered), &doc); err != nil {
			t.Fatal(err)
		}
		if got := doc.Services["beszel-socket-proxy"].Ports; len(got) != 1 || got[0] != "127.0.0.1:45877:2375" {
			t.Errorf("BIND_IP=%s: proxy ports = %v, want loopback only", exposure, got)
		}
		if got := doc.Services["beszel"].Ports; len(got) != 1 || got[0] != exposure+":8090:8090" {
			t.Errorf("BIND_IP=%s: hub ports = %v, want the Exposure's address", exposure, got)
		}
	}
}

func TestAgentReadsItsSettingsFromTheProjectSecrets(t *testing.T) {
	source, _ := fragment(t)
	for _, want := range []string{"${BESZEL_AGENT_KEY:-}", "${BESZEL_AGENT_TOKEN:-}"} {
		if !strings.Contains(source, want) {
			t.Errorf("fragment should refer to %s so the secrets file supplies it", want)
		}
	}
}
