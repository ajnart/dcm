package homarr_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/homarr"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fakeHomarr models exactly the endpoints Homarr Setup, Check and the Links
// use, including the claim cookie, the administrator session and the
// integration connection test.
type fakeHomarr struct {
	mu            sync.Mutex
	adminExists   bool
	adminName     string
	adminPassword string
	step          string
	claimToken    string
	sessionToken  string
	apiKey        string
	apps          []map[string]any
	integrations  []map[string]any
	items         []map[string]any
	sections      []any
	nextID        int
}

func newFake() *fakeHomarr { return &fakeHomarr{step: "start", nextID: 1} }

func (f *fakeHomarr) id(prefix string) string {
	id := prefix + "-" + strconv.Itoa(f.nextID)
	f.nextID++
	return id
}

func trpc(w http.ResponseWriter, value any) {
	json.NewEncoder(w).Encode(map[string]any{
		"result": map[string]any{"data": map[string]any{"json": value}},
	})
}

func trpcError(w http.ResponseWriter) {
	json.NewEncoder(w).Encode(map[string]any{
		"result": map[string]any{"data": map[string]any{"json": map[string]any{
			"error": map[string]any{"message": "connection failed"},
		}}},
	})
}

func inputOf(r *http.Request) map[string]any {
	var body struct {
		JSON map[string]any `json:"json"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	return body.JSON
}

func (f *fakeHomarr) claimCookie(w http.ResponseWriter, r *http.Request) bool {
	cookie, err := r.Cookie("homarr-onboarding-claim")
	return err == nil && cookie.Value == f.claimToken
}

func (f *fakeHomarr) sessionAdmin(r *http.Request) bool {
	cookie, err := r.Cookie("authjs.session-token")
	return err == nil && cookie.Value == f.sessionToken
}

func (f *fakeHomarr) keyOK(r *http.Request) bool {
	return f.apiKey != "" && r.Header.Get("ApiKey") == f.apiKey
}

func (f *fakeHomarr) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("GET /api/trpc/onboard.currentStep", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		trpc(w, map[string]any{"current": f.step, "previous": nil})
	})
	mux.HandleFunc("POST /api/onboarding/claim", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.claimToken = "claim-token"
		http.SetCookie(w, &http.Cookie{Name: "homarr-onboarding-claim", Value: f.claimToken, Path: "/"})
		json.NewEncoder(w).Encode(map[string]any{"status": "issued"})
	})
	mux.HandleFunc("POST /api/trpc/onboard.nextStep", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.claimCookie(w, r) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if f.step != "start" {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		f.step = "user"
		trpc(w, nil)
	})
	mux.HandleFunc("POST /api/trpc/user.initUser", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.claimCookie(w, r) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if f.step != "user" {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		input := inputOf(r)
		f.adminExists = true
		f.adminName, _ = input["username"].(string)
		f.adminPassword, _ = input["password"].(string)
		f.step = "setup"
		trpc(w, nil)
	})
	mux.HandleFunc("GET /api/auth/csrf", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"csrfToken": "csrf-token"})
	})
	mux.HandleFunc("POST /api/auth/callback/credentials", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if !f.adminExists || r.PostForm.Get("name") != f.adminName || r.PostForm.Get("password") != f.adminPassword {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		f.sessionToken = "session-token"
		http.SetCookie(w, &http.Cookie{Name: "authjs.session-token", Value: f.sessionToken, Path: "/"})
		w.Write([]byte(`{}`))
	})
	mux.HandleFunc("GET /api/auth/session", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.sessionAdmin(r) {
			json.NewEncoder(w).Encode(map[string]any{})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"name": f.adminName, "permissions": []string{"admin"}}})
	})
	mux.HandleFunc("POST /api/trpc/onboard.completeSetup", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.step != "setup" || !f.sessionAdmin(r) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		f.step = "finish"
		trpc(w, nil)
	})
	mux.HandleFunc("POST /api/trpc/apiKeys.create", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.sessionAdmin(r) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		f.apiKey = "keyid.secret"
		trpc(w, map[string]any{"apiKey": f.apiKey})
	})
	mux.HandleFunc("GET /api/trpc/apiKeys.getAll", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		trpc(w, []any{map[string]any{"id": "keyid"}})
	})
	mux.HandleFunc("GET /api/apps", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.apps == nil {
			json.NewEncoder(w).Encode([]any{})
			return
		}
		json.NewEncoder(w).Encode(f.apps)
	})
	mux.HandleFunc("POST /api/apps", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		id := f.id("app")
		body["appId"] = id
		body["id"] = id
		f.apps = append(f.apps, body)
		json.NewEncoder(w).Encode(map[string]any{"appId": id, "id": id})
	})
	mux.HandleFunc("DELETE /api/apps/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		kept := f.apps[:0]
		for _, item := range f.apps {
			if item["id"] != id {
				kept = append(kept, item)
			}
		}
		f.apps = kept
		json.NewEncoder(w).Encode(map[string]any{})
	})
	mux.HandleFunc("GET /api/trpc/integration.all", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.integrations == nil {
			trpc(w, []any{})
			return
		}
		trpc(w, f.integrations)
	})
	mux.HandleFunc("POST /api/trpc/integration.create", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		input := inputOf(r)
		secrets, _ := input["secrets"].([]any)
		for _, raw := range secrets {
			record, _ := raw.(map[string]any)
			if value, _ := record["value"].(string); value == "" {
				trpcError(w)
				return
			}
		}
		id := f.id("integration")
		integration := map[string]any{
			"id": id, "name": input["name"], "url": input["url"], "kind": input["kind"],
		}
		f.integrations = append(f.integrations, integration)
		trpc(w, map[string]any{"integration": integration})
	})
	mux.HandleFunc("POST /api/trpc/integration.delete", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		input := inputOf(r)
		id, _ := input["id"].(string)
		kept := f.integrations[:0]
		for _, item := range f.integrations {
			if item["id"] != id {
				kept = append(kept, item)
			}
		}
		f.integrations = kept
		trpc(w, nil)
	})
	mux.HandleFunc("GET /api/boards", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode([]any{map[string]any{"id": "board-1", "name": "Home"}})
	})
	mux.HandleFunc("POST /api/boards/items", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		body["itemId"] = f.id("item")
		body["id"] = body["itemId"]
		if body["integrationIds"] == nil {
			body["integrationIds"] = []any{}
		}
		f.items = append(f.items, body)
		json.NewEncoder(w).Encode(map[string]any{"itemId": body["itemId"]})
	})
	mux.HandleFunc("GET /api/trpc/board.getBoardByName", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		items := f.items
		if items == nil {
			items = []map[string]any{}
		}
		sections := f.sections
		if sections == nil {
			sections = []any{}
		}
		trpc(w, map[string]any{
			"id": "board-1", "name": "Home", "isPublic": false,
			"sections": sections, "layouts": []any{}, "items": items,
		})
	})
	mux.HandleFunc("POST /api/trpc/board.saveBoard", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		input := inputOf(r)
		var items []map[string]any
		if raw, ok := input["items"].([]any); ok {
			for _, value := range raw {
				if record, ok := value.(map[string]any); ok {
					items = append(items, record)
				}
			}
		}
		f.items = items
		if raw, ok := input["sections"].([]any); ok {
			f.sections = raw
		}
		trpc(w, nil)
	})
	mux.HandleFunc("POST /api/trpc/widget.notebook.updateContent", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		input := inputOf(r)
		itemID, _ := input["itemId"].(string)
		content, _ := input["content"].(string)
		for _, item := range f.items {
			if item["id"] != itemID {
				continue
			}
			options, _ := item["options"].(map[string]any)
			if options == nil {
				options = map[string]any{}
				item["options"] = options
			}
			options["content"] = content
		}
		trpc(w, nil)
	})
	return mux
}

func serve(t *testing.T, fake *fakeHomarr) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	return srv
}

func installEnv(t *testing.T, fake *fakeHomarr) (*system.Deps, *httptest.Server, *catalog.Catalog) {
	t.Helper()
	srv := serve(t, fake)
	deps := systemtest.NewDeps(t)
	return deps, srv, catalog.New([]app.App{homarr.App{}}, nil)
}

func TestFreshInstallReachesFinishAndStoresAnAPIKey(t *testing.T) {
	fake := newFake()
	deps, srv, cat := installEnv(t, fake)

	r := clitest.Run(t, deps, cat, "install", "homarr", "--yes", "--json", "--set", "homarr.port="+clitest.Port(srv))

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	fake.mu.Lock()
	step := fake.step
	fake.mu.Unlock()
	if step != "finish" {
		t.Fatalf("onboarding step %q, want finish\n%s", step, r.Out)
	}
	secrets := clitest.Read(t, filepath.Join(clitest.Root(t, deps), "secrets.env"))
	for _, want := range []string{"HOMARR_SECRET_ENCRYPTION_KEY=", "HOMARR_API_KEY="} {
		if !strings.Contains(secrets, want) {
			t.Errorf("secrets.env lacks %s:\n%s", want, secrets)
		}
	}
	for _, step := range []string{"admin", "onboarding", "api-key", "notebook", "check"} {
		if r.StepEvent("homarr", step) != "step.ok" {
			t.Errorf("step %s not ok:\n%s", step, r.Out)
		}
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := newFake()
	deps, srv, cat := installEnv(t, fake)
	clitest.Run(t, deps, cat, "install", "homarr", "--yes", "--set", "homarr.port="+clitest.Port(srv))

	r := clitest.Run(t, deps, cat, "setup", "homarr", "--json")

	if r.Code != 0 {
		t.Fatalf("exit %d\n%s", r.Code, r.Out)
	}
	for _, step := range []string{"admin", "onboarding", "api-key", "notebook"} {
		if r.StepEvent("homarr", step) != "step.skip" {
			t.Errorf("step %s should skip:\n%s", step, r.Out)
		}
	}
}

func TestForeignAdministratorFailsTheAdminStepWithAHint(t *testing.T) {
	fake := newFake()
	fake.adminExists = true
	fake.adminName = "admin"
	fake.adminPassword = "someone-elses-password"
	fake.step = "setup"
	deps, srv, cat := installEnv(t, fake)

	r := clitest.Run(t, deps, cat, "install", "homarr", "--yes", "--json", "--set", "homarr.port="+clitest.Port(srv))

	if r.Code != 2 {
		t.Fatalf("exit %d, want 2\n%s", r.Code, r.Out)
	}
	fail := r.Step("homarr", "admin")
	if fail == nil || fail["event"] != "step.fail" {
		t.Fatalf("admin step should fail:\n%s", r.Out)
	}
	if !strings.Contains(fail["error"].(string), "another administrator") {
		t.Errorf("error should say another administrator owns Homarr: %v", fail["error"])
	}
	if hint, _ := fail["hint"].(string); !strings.Contains(hint, "administrator") || !strings.Contains(hint, "self-host credentials") {
		t.Errorf("hint should name the App page and the credentials command: %q", hint)
	}
}

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

func homarrH(t *testing.T, srv *httptest.Server, secrets fakeSecrets) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "homarr", Service: "homarr", BaseURL: srv.URL, URL: srv.URL,
		HTTP: srv.Client(), Secrets: secrets, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
	})
}

func targetH(t *testing.T, srv *httptest.Server, id string, port int, secrets fakeSecrets) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: id, Service: id, URL: "http://" + id + ".example", Port: port,
		HTTP: srv.Client(), Secrets: secrets, Log: events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
	})
}

func linkFor(t *testing.T, target string) app.Link {
	t.Helper()
	for _, link := range (homarr.App{}).Links() {
		if link.Target == target {
			return link
		}
	}
	t.Fatalf("no Link to %s", target)
	return app.Link{}
}

func TestLinkApplyCreatesAppIntegrationAndTileAndRerunsIdempotently(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, fakeSecrets{"HOMARR_API_KEY": "keyid.secret", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	to := targetH(t, srv, "sonarr", 8989, fakeSecrets{"SONARR_API_KEY": "sonarr-secret"})
	link := linkFor(t, "sonarr")

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("apply: %v", err)
	}
	fake.mu.Lock()
	apps, integrations, items := len(fake.apps), len(fake.integrations), len(fake.items)
	fake.mu.Unlock()
	if apps != 1 || integrations != 1 || items != 5 {
		t.Fatalf("apps=%d integrations=%d items=%d, want 1/1/5", apps, integrations, items)
	}

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	fake.mu.Lock()
	apps, integrations, items = len(fake.apps), len(fake.integrations), len(fake.items)
	fake.mu.Unlock()
	if apps != 1 || integrations != 1 || items != 5 {
		t.Fatalf("rerun added duplicates: apps=%d integrations=%d items=%d", apps, integrations, items)
	}
}

func TestLinkRemoveDeletesTheAppAndIntegration(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, fakeSecrets{"HOMARR_API_KEY": "keyid.secret", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	to := targetH(t, srv, "sonarr", 8989, fakeSecrets{"SONARR_API_KEY": "sonarr-secret"})
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("apply: %v", err)
	}

	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatalf("remove: %v", err)
	}
	fake.mu.Lock()
	apps, integrations, items := len(fake.apps), len(fake.integrations), len(fake.items)
	widgets := 0
	for _, item := range fake.items {
		switch item["kind"] {
		case "calendar", "mediaMissing", "stats":
			widgets++
		}
	}
	fake.mu.Unlock()
	if apps != 0 || integrations != 0 {
		t.Fatalf("apps=%d integrations=%d, want them removed", apps, integrations)
	}
	if widgets != 0 {
		t.Fatalf("%d Sonarr widgets survived removal, want 0 (items=%d)", widgets, items)
	}
}

func TestAFailedIntegrationTestIsAnError(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, fakeSecrets{"HOMARR_API_KEY": "keyid.secret", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	to := targetH(t, srv, "sonarr", 8989, fakeSecrets{"SONARR_API_KEY": ""})
	link := linkFor(t, "sonarr")

	err := link.Apply(context.Background(), from, to)

	if err == nil {
		t.Fatal("a failed integration connection test must fail the Link")
	}
	fake.mu.Lock()
	integrations := len(fake.integrations)
	fake.mu.Unlock()
	if integrations != 0 {
		t.Fatalf("a failed test must create no integration, got %d", integrations)
	}
}

func TestTileOnlyTargetSkipsTheIntegration(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, fakeSecrets{"HOMARR_API_KEY": "keyid.secret", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw"})
	to := targetH(t, srv, "ntfy", 2586, fakeSecrets{})
	link := linkFor(t, "ntfy")

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("apply: %v", err)
	}
	fake.mu.Lock()
	apps, integrations, items := len(fake.apps), len(fake.integrations), len(fake.items)
	fake.mu.Unlock()
	if apps != 1 || items != 2 || integrations != 0 {
		t.Fatalf("tile-only: apps=%d items=%d integrations=%d, want 1/2/0", apps, items, integrations)
	}
}

func widgetCount(items []map[string]any, kind, integrationID string) int {
	count := 0
	for _, item := range items {
		if item["kind"] != kind {
			continue
		}
		ids, _ := item["integrationIds"].([]any)
		for _, id := range ids {
			if id == integrationID {
				count++
				break
			}
		}
	}
	return count
}

func notebooks(items []map[string]any) []map[string]any {
	var found []map[string]any
	for _, item := range items {
		if item["kind"] != "notebook" {
			continue
		}
		options, _ := item["options"].(map[string]any)
		if content, _ := options["content"].(string); strings.Contains(content, "Your homelab at a glance") {
			found = append(found, item)
		}
	}
	return found
}

func allSecrets() fakeSecrets {
	return fakeSecrets{
		"HOMARR_API_KEY": "keyid.secret", "ADMIN_USER": "admin", "ADMIN_PASSWORD": "pw",
		"SONARR_API_KEY": "sonarr-secret", "RADARR_API_KEY": "radarr-secret",
		"PROWLARR_API_KEY": "prowlarr-secret", "JELLYFIN_API_KEY": "jellyfin-secret",
		"SEERR_API_KEY": "seerr-secret",
	}
}

func TestEachLinkAddsItsWidgetsWiredToItsIntegration(t *testing.T) {
	cases := map[string][]string{
		"sonarr":      {"calendar", "mediaMissing", "stats"},
		"radarr":      {"calendar", "mediaMissing", "stats"},
		"prowlarr":    {"indexerManager", "stats"},
		"jellyfin":    {"mediaServer", "mediaReleases", "stats"},
		"seerr":       {"mediaRequests-requestList", "mediaRequests-requestStats", "stats"},
		"qbittorrent": {"downloads", "stats"},
	}
	for targetID, kinds := range cases {
		t.Run(targetID, func(t *testing.T) {
			fake := newFake()
			fake.apiKey = "keyid.secret"
			srv := serve(t, fake)
			from := homarrH(t, srv, allSecrets())
			to := targetH(t, srv, targetID, 1234, allSecrets())

			if err := linkFor(t, targetID).Apply(context.Background(), from, to); err != nil {
				t.Fatalf("apply: %v", err)
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if len(fake.integrations) != 1 {
				t.Fatalf("integrations=%d, want 1", len(fake.integrations))
			}
			integrationID, _ := fake.integrations[0]["id"].(string)
			if integrationID == "" {
				t.Fatal("the integration has no id")
			}
			for _, kind := range kinds {
				if got := widgetCount(fake.items, kind, integrationID); got != 1 {
					t.Errorf("widget %q wired to %s: %d, want 1", kind, integrationID, got)
				}
			}
		})
	}
}

func TestLinkWidgetsAreNotDuplicatedOnRerun(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("apply: %v", err)
	}
	fake.mu.Lock()
	before := len(fake.items)
	fake.mu.Unlock()

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	fake.mu.Lock()
	after := len(fake.items)
	fake.mu.Unlock()
	if after != before {
		t.Fatalf("rerun changed items from %d to %d", before, after)
	}
}

func TestNotebookExistsOnceAndListsAppsWithoutSecrets(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())

	if err := linkFor(t, "sonarr").Apply(context.Background(), from, targetH(t, srv, "sonarr", 8989, allSecrets())); err != nil {
		t.Fatalf("sonarr: %v", err)
	}
	if err := linkFor(t, "qbittorrent").Apply(context.Background(), from, targetH(t, srv, "qbittorrent", 8080, allSecrets())); err != nil {
		t.Fatalf("qbittorrent: %v", err)
	}

	fake.mu.Lock()
	notes := notebooks(fake.items)
	fake.mu.Unlock()
	if len(notes) != 1 {
		t.Fatalf("notebooks=%d, want exactly 1", len(notes))
	}
	options, _ := notes[0]["options"].(map[string]any)
	content, _ := options["content"].(string)
	for _, want := range []string{"Your homelab at a glance", ">Sonarr</a>", ">qBittorrent</a>", "self-host credentials"} {
		if !strings.Contains(content, want) {
			t.Errorf("notebook lacks %q:\n%s", want, content)
		}
	}
	for _, secret := range []string{"pw", "keyid.secret", "sonarr-secret"} {
		if strings.Contains(content, secret) {
			t.Errorf("notebook leaked %q:\n%s", secret, content)
		}
	}

	if err := linkFor(t, "sonarr").Apply(context.Background(), from, targetH(t, srv, "sonarr", 8989, allSecrets())); err != nil {
		t.Fatalf("sonarr rerun: %v", err)
	}
	fake.mu.Lock()
	notes = notebooks(fake.items)
	fake.mu.Unlock()
	if len(notes) != 1 {
		t.Fatalf("rerun created a second notebook: %d", len(notes))
	}
}
