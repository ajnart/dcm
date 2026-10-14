package ntfy_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/ntfy"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fakeNtfy models the parts of the ntfy server API that Setup uses.
type fakeNtfy struct {
	mu               sync.Mutex
	users            map[string]string
	tokens           map[string]string
	nextToken        int
	anonymousCanRead bool
}

func (f *fakeNtfy) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"healthy":true}`))
	})
	mux.HandleFunc("GET /v1/account", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		f.mu.Lock()
		defer f.mu.Unlock()
		if !ok {
			json.NewEncoder(w).Encode(map[string]string{"username": "*", "role": "anonymous"})
			return
		}
		if f.users[user] != pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"username": user, "role": "admin"})
	})
	mux.HandleFunc("POST /v1/account/token", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		f.mu.Lock()
		defer f.mu.Unlock()
		if !ok || f.users[user] != pass {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.nextToken++
		token := "tk_test_" + strconv.Itoa(f.nextToken)
		f.tokens[token] = user
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	})
	mux.HandleFunc("GET /{topic}/json", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if _, _, ok := r.BasicAuth(); ok {
			w.Write([]byte(""))
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if _, ok := f.tokens[token]; token != "" && ok {
			w.Write([]byte(""))
			return
		}
		if f.anonymousCanRead {
			w.Write([]byte(""))
			return
		}
		w.WriteHeader(http.StatusForbidden)
	})
	return mux
}

func setup(t *testing.T) (*system.Deps, *fakeNtfy, *httptest.Server, *catalog.Catalog) {
	fake := &fakeNtfy{users: map[string]string{}, tokens: map[string]string{}}
	server := httptest.NewServer(fake.handler())
	t.Cleanup(server.Close)
	deps := systemtest.NewDeps(t)
	deps.Runner.(*systemtest.Runner).OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		line := systemtest.Line(cmd)
		if strings.Contains(line, "exec -T -e NTFY_PASSWORD ntfy ntfy user add --role=admin ") {
			user := line[strings.LastIndex(line, " ")+1:]
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if _, exists := fake.users[user]; exists {
				return system.Result{ExitCode: 1, Stderr: []byte("user " + user + " already exists")}
			}
			fake.users[user] = clitest.Env(cmd)["NTFY_PASSWORD"]
		}
		if strings.Contains(line, "exec -T -e NTFY_PASSWORD ntfy ntfy user change-pass ") {
			user := line[strings.LastIndex(line, " ")+1:]
			fake.mu.Lock()
			defer fake.mu.Unlock()
			fake.users[user] = clitest.Env(cmd)["NTFY_PASSWORD"]
		}
		return system.Result{}
	})
	cat := catalog.New([]app.App{ntfy.App{}}, nil)
	return deps, fake, server, cat
}

func TestInstallCreatesAdminAndDeniesAnonymousReads(t *testing.T) {
	deps, fake, server, cat := setup(t)

	r := clitest.Run(t, deps, cat, "install", "ntfy", "--yes", "--json", "--set", "ntfy.port="+clitest.Port(server))

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	fragment := clitest.Read(t, filepath.Join(clitest.Root(t, deps), "apps", "ntfy", "compose.yml"))
	for _, want := range []string{"image: binwiederhier/ntfy:latest", "NTFY_AUTH_DEFAULT_ACCESS: deny-all", "TZ: ${TZ}", "${BIND_IP}:" + clitest.Port(server) + ":80"} {
		if !strings.Contains(fragment, want) {
			t.Errorf("fragment lacks %q:\n%s", want, fragment)
		}
	}
	creds := clitest.Run(t, deps, cat, "credentials", "--json")
	var parsed struct {
		Admin struct{ Username, Password string }
	}
	json.Unmarshal([]byte(creds.Out), &parsed)
	if fake.users["admin"] == "" || fake.users["admin"] != parsed.Admin.Password {
		t.Fatalf("ntfy admin not created with the Admin login: %v", fake.users)
	}
	secrets := clitest.Read(t, filepath.Join(clitest.Root(t, deps), "secrets.env"))
	for _, want := range []string{"NTFY_TOPIC=", "NTFY_HOMARR_TOKEN="} {
		if !strings.Contains(secrets, want) {
			t.Errorf("secrets.env lacks %s:\n%s", want, secrets)
		}
	}
	if r.StepEvent("ntfy", "admin-user") != "step.ok" || r.StepEvent("ntfy", "topic-token") != "step.ok" || r.StepEvent("ntfy", "check") != "step.ok" {
		t.Fatalf("steps not ok:\n%s", r.Out)
	}
}

func TestInstallPreparesTheDataBindBeforeRootfulDocker(t *testing.T) {
	deps, _, server, cat := setup(t)

	r := clitest.Run(t, deps, cat, "install", "ntfy", "--yes", "--set", "ntfy.port="+clitest.Port(server))
	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	info, err := os.Stat(filepath.Join(clitest.Root(t, deps), "apps", "ntfy", "data"))
	if err != nil || !info.IsDir() {
		t.Fatalf("ntfy data bind was not prepared before Docker: %v", err)
	}
}

// fakeSecrets is the in-memory store a direct Check uses.
type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func TestCheckRejectsATokenThatCannotReadTheTopic(t *testing.T) {
	deps, fake, server, _ := setup(t)
	fake.users["admin"] = "pw"
	h := helpers.New(helpers.Config{
		App: "ntfy", Service: "ntfy", BaseURL: server.URL, URL: server.URL,
		HTTP: server.Client(), Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Secrets: fakeSecrets{
			"ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw",
			"NTFY_TOPIC": "topic", "NTFY_HOMARR_TOKEN": "stale",
		},
	})

	err := (ntfy.App{}).Check(context.Background(), h)
	if err == nil || !strings.Contains(err.Error(), "token") {
		t.Fatalf("check should reject a token that cannot read the topic: %v", err)
	}
}

func TestSetupRerunSkipsAdminCreation(t *testing.T) {
	deps, _, server, cat := setup(t)
	clitest.Run(t, deps, cat, "install", "ntfy", "--yes", "--set", "ntfy.port="+clitest.Port(server))

	r := clitest.Run(t, deps, cat, "setup", "ntfy", "--json")

	if r.Code != 0 || r.StepEvent("ntfy", "admin-user") != "step.skip" {
		t.Fatalf("exit %d, admin-user should skip:\n%s", r.Code, r.Out)
	}
}

func TestSetupRepairsAChangedAdminPassword(t *testing.T) {
	deps, fake, server, cat := setup(t)
	clitest.Run(t, deps, cat, "install", "ntfy", "--yes", "--set", "ntfy.port="+clitest.Port(server))
	fake.users["admin"] = "changed-by-hand"

	r := clitest.Run(t, deps, cat, "setup", "ntfy", "--json")

	if r.Code != 0 || r.StepEvent("ntfy", "admin-user") != "step.ok" {
		t.Fatalf("exit %d, admin-user should be repaired:\n%s", r.Code, r.Out)
	}
}

func TestOpenTopicsFailTheCheckWithAHint(t *testing.T) {
	deps, fake, server, cat := setup(t)
	fake.anonymousCanRead = true

	r := clitest.Run(t, deps, cat, "install", "ntfy", "--yes", "--json", "--set", "ntfy.port="+clitest.Port(server))

	if r.Code != 2 {
		t.Fatalf("exit %d, want 2\n%s", r.Code, r.Out)
	}
	fail := r.Step("ntfy", "check")
	if fail == nil || fail["event"] != "step.fail" || !strings.Contains(fail["error"].(string), "anonymous") {
		t.Fatalf("check should fail on anonymous access:\n%s", r.Out)
	}
}
