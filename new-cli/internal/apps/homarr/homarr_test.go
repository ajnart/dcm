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
	boards        []map[string]any
	readBoard     string
	rejectUpdates bool
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
	mux.HandleFunc("GET /v1/account", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ntfy-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"username": "admin", "role": "admin"})
	})
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
		// Pinned eb1d449 appManageSchema requires a nonempty string iconUrl
		// for POST /api/apps; only create-many permits a nullable icon.
		icon, ok := body["iconUrl"].(string)
		if !ok || strings.TrimSpace(icon) == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"message": "Input validation failed", "field": "iconUrl"})
			return
		}
		id := f.id("app")
		body["appId"] = id
		body["id"] = id
		f.apps = append(f.apps, body)
		json.NewEncoder(w).Encode(map[string]any{"appId": id, "id": id})
	})
	mux.HandleFunc("PATCH /api/apps/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		for _, item := range f.apps {
			if appID, _ := item["id"].(string); appID == r.PathValue("id") {
				for key, value := range body {
					item[key] = value
				}
			}
		}
		json.NewEncoder(w).Encode(map[string]any{})
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
			"secrets": input["secrets"],
		}
		f.integrations = append(f.integrations, integration)
		trpc(w, map[string]any{"integration": integration})
	})
	mux.HandleFunc("POST /api/trpc/integration.update", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		input := inputOf(r)
		if f.rejectUpdates {
			trpcError(w)
			return
		}
		for _, item := range f.integrations {
			if item["id"] == input["id"] {
				for key, value := range input {
					item[key] = value
				}
			}
		}
		trpc(w, nil)
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
		if f.boards != nil {
			json.NewEncoder(w).Encode(f.boards)
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
		var input struct {
			JSON struct {
				Name string `json:"name"`
			} `json:"json"`
		}
		json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
		f.readBoard = input.JSON.Name
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
		App: id, Service: id, BaseURL: srv.URL, URL: "http://" + id + ".example", Port: port,
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
	to := targetH(t, srv, "vaultwarden", 80, fakeSecrets{})
	link := linkFor(t, "vaultwarden")

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
		"NTFY_TOPIC":    "ntfy-topic", "NTFY_HOMARR_TOKEN": "ntfy-token",
	}
}

func TestIntegrationWidgetsHaveReadableInitialSizes(t *testing.T) {
	for _, targetID := range []string{"ntfy", "jellyfin"} {
		t.Run(targetID, func(t *testing.T) {
			fake := newFake()
			fake.apiKey = "keyid.secret"
			srv := serve(t, fake)
			from := homarrH(t, srv, allSecrets())
			to := targetH(t, srv, targetID, 1234, allSecrets())
			if err := linkFor(t, targetID).Apply(context.Background(), from, to); err != nil {
				t.Fatal(err)
			}
			fake.mu.Lock()
			for _, item := range fake.items {
				kind, _ := item["kind"].(string)
				if kind == "app" || kind == "notebook" {
					continue
				}
				size, _ := item["size"].(map[string]any)
				expectedWidth := float64(4)
				expectedHeight := float64(3)
				if kind == "stats" || kind == "mediaServer" {
					expectedWidth = 3
					expectedHeight = 2
				}
				if size["width"] != expectedWidth || size["height"] != expectedHeight {
					t.Errorf("%s must receive an explicit readable initial size", kind)
				}
			}
			// Subsequent setup preserves the user's resized owned widget.
			for _, item := range fake.items {
				if item["kind"] == "stats" {
					item["size"] = map[string]any{"width": float64(5), "height": float64(4)}
				}
			}
			count := len(fake.items)
			fake.mu.Unlock()
			if err := linkFor(t, targetID).Apply(context.Background(), from, to); err != nil {
				t.Fatal(err)
			}
			fake.mu.Lock()
			defer fake.mu.Unlock()
			if len(fake.items) != count {
				t.Fatal("rerun duplicated sized widgets")
			}
			for _, item := range fake.items {
				if item["kind"] == "stats" {
					size, _ := item["size"].(map[string]any)
					if size["width"] != float64(5) || size["height"] != float64(4) {
						t.Fatal("user size replaced on rerun")
					}
				}
			}
		})
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
		"ntfy":        {"notifications", "stats"},
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

func TestNtfyIntegrationCarriesTopicAndAPIKey(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "ntfy", 2586, allSecrets())

	if err := linkFor(t, "ntfy").Apply(context.Background(), from, to); err != nil {
		t.Fatalf("apply: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.integrations) != 1 {
		t.Fatalf("integrations=%d, want 1", len(fake.integrations))
	}
	if kind, _ := fake.integrations[0]["kind"].(string); kind != "ntfy" {
		t.Fatalf("integration kind=%q, want ntfy", kind)
	}
	if url, _ := fake.integrations[0]["url"].(string); url != "http://ntfy:80" {
		t.Fatalf("integration url=%q, want http://ntfy:80", url)
	}
	secrets, _ := fake.integrations[0]["secrets"].([]any)
	got := map[string]string{}
	for _, raw := range secrets {
		record, _ := raw.(map[string]any)
		kind, _ := record["kind"].(string)
		value, _ := record["value"].(string)
		got[kind] = value
	}
	if got["topic"] != "ntfy-topic" || got["apiKey"] != "ntfy-token" {
		t.Fatalf("secrets=%v, want topic+apiKey from NTFY_TOPIC/NTFY_HOMARR_TOKEN", got)
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

func TestLinkRerunRepairsMissingTileAndChangedBrowserURL(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	kept := fake.items[:0]
	for _, item := range fake.items {
		if item["kind"] != "app" {
			kept = append(kept, item)
		}
	}
	fake.items = kept
	fake.mu.Unlock()
	to.URL = "http://new-host.example:18989"
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	tiles := 0
	for _, item := range fake.items {
		if item["kind"] == "app" {
			tiles++
		}
	}
	if tiles != 1 || len(fake.apps) != 1 || fake.apps[0]["href"] != to.URL {
		t.Fatalf("tile or browser URL not repaired: tiles=%d apps=%v", tiles, fake.apps)
	}
}

func TestRemovalReconcilesPartiallyMissingWidgets(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	kept := fake.items[:0]
	for _, item := range fake.items {
		if item["kind"] != "calendar" {
			kept = append(kept, item)
		}
	}
	fake.items = kept
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 0 || len(fake.integrations) != 0 {
		t.Fatalf("partial removal left Apps/integrations: %v/%v", fake.apps, fake.integrations)
	}
	for _, item := range fake.items {
		if item["kind"] != "notebook" {
			t.Fatalf("partial removal left widget: %v", item)
		}
	}
}

func TestLinkReconcilesRotatedIntegrationCredential(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	secrets["SONARR_API_KEY"] = "rotated-key"
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.integrations) != 1 {
		t.Fatalf("rotation duplicated integration: %v", fake.integrations)
	}
	values, _ := fake.integrations[0]["secrets"].([]any)
	value, _ := values[0].(map[string]any)
	if value["value"] != "rotated-key" {
		t.Fatalf("rotation not reconciled: %v", value)
	}
}

func TestLinkUsesHomeBoardWhenAnotherBoardIsListedFirst(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.boards = []map[string]any{{"id": "other", "name": "Other"}, {"id": "board-1", "name": "Home"}}
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	if err := linkFor(t, "sonarr").Apply(context.Background(), from, targetH(t, srv, "sonarr", 8989, allSecrets())); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.readBoard != "Home" {
		t.Fatalf("published to %q, want owned Home", fake.readBoard)
	}
}

func TestSetupReconcilesGenericInstalledAppTilesAndNotebook(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists = true
	fake.adminName = "admin"
	fake.adminPassword = "pw"
	fake.step = "finish"
	srv := serve(t, fake)
	h := homarrH(t, srv, allSecrets())
	installed := []helpers.InstalledApp{{ID: "gatus", Name: "Gatus", URL: "http://host.example:8081", Service: "gatus", ContainerPort: 8080}, {ID: "valkey", Name: "Valkey"}}
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) { return installed, nil }
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	if len(fake.apps) != 1 || fake.apps[0]["href"] != "http://host.example:8081" {
		t.Fatalf("generic App missing: %v", fake.apps)
	}
	notes := notebooks(fake.items)
	options, _ := notes[0]["options"].(map[string]any)
	content, _ := options["content"].(string)
	if !strings.Contains(content, "Gatus") || !strings.Contains(content, "Valkey") || !strings.Contains(content, "no browser endpoint") {
		t.Fatalf("incomplete notebook: %s", content)
	}
	createdID := fake.apps[0]["id"]
	fake.apps[0]["iconUrl"] = "https://example.test/custom-gatus.svg"
	fake.mu.Unlock()
	installed[0].URL = "http://host.example:8082"
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	if len(fake.apps) != 1 || fake.apps[0]["id"] != createdID || fake.apps[0]["iconUrl"] != "https://example.test/custom-gatus.svg" || fake.apps[0]["href"] != installed[0].URL {
		t.Fatal("URL reconciliation duplicated the generic tile or replaced its customized icon")
	}
	fake.apps = append(fake.apps, map[string]any{"id": "user-app", "name": "My app", "href": "http://private.example", "pingUrl": "http://private.example"})
	fake.mu.Unlock()
	installed = []helpers.InstalledApp{{ID: "forgejo", Name: "Forgejo", URL: "http://host.example:3001", Service: "forgejo", ContainerPort: 3000}}
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 2 {
		t.Fatalf("generic reconciliation lost unrelated App or duplicated: %v", fake.apps)
	}
	for _, item := range fake.apps {
		if item["name"] == "Gatus" {
			t.Fatalf("removed App survived: %v", item)
		}
	}
}

func TestRemovalPreservesUserWidgetOnManagedIntegration(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.items = append(fake.items, map[string]any{"id": "user-widget", "kind": "calendar", "integrationIds": []any{fake.integrations[0]["id"]}, "options": map[string]any{}})
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["id"] == "user-widget" {
			return
		}
	}
	t.Fatal("removal deleted user-owned widget")
}

func TestRemovalCleansWidgetsAfterIntegrationWasDeleted(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.integrations = nil
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["kind"] != "notebook" {
			t.Fatalf("orphan survived removal: %v", item)
		}
	}
}

func TestLinkRepairsManagedStatsOptionsWithoutDuplicatingWidget(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	for _, item := range fake.items {
		if item["kind"] == "stats" {
			item["options"] = map[string]any{"entries": []any{}}
		}
	}
	fake.mu.Unlock()
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	count := 0
	for _, item := range fake.items {
		if item["kind"] == "stats" {
			count++
			options, _ := item["options"].(map[string]any)
			entries, _ := options["entries"].([]any)
			if len(entries) != 4 {
				t.Fatalf("stats options not repaired: %v", options)
			}
		}
	}
	if count != 1 {
		t.Fatalf("stats widgets=%d, want one", count)
	}
}

func TestInstalledSupportedAppGetsTileBeforeItsIntegrationIsReady(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists = true
	fake.adminName = "admin"
	fake.adminPassword = "pw"
	fake.step = "finish"
	srv := serve(t, fake)
	h := homarrH(t, srv, allSecrets())
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) {
		return []helpers.InstalledApp{{ID: "ntfy", Name: "ntfy", URL: "http://ntfy.example", Service: "ntfy", ContainerPort: 80}}, nil
	}
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	if len(fake.apps) != 1 || len(fake.integrations) != 0 {
		t.Fatalf("tile-only publication wrong: apps=%v integrations=%v", fake.apps, fake.integrations)
	}
	fake.mu.Unlock()
	if err := linkFor(t, "ntfy").Apply(context.Background(), h, targetH(t, srv, "ntfy", 2586, allSecrets())); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 1 || len(fake.integrations) != 1 {
		t.Fatalf("Link duplicated tile: apps=%v integrations=%v", fake.apps, fake.integrations)
	}
}

func TestLinkRepairsStatsAndMissingTileTogether(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	kept := fake.items[:0]
	for _, item := range fake.items {
		if item["kind"] == "app" {
			continue
		}
		if item["kind"] == "stats" {
			item["options"] = map[string]any{"entries": []any{}}
		}
		kept = append(kept, item)
	}
	fake.items = kept
	fake.mu.Unlock()
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
}

func TestLinkRerunReplacesDeletedIntegrationWithoutOrphanWidgets(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.integrations = nil
	fake.mu.Unlock()
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.integrations) != 1 || len(fake.items) != 5 {
		t.Fatalf("replacement kept orphan widgets: integrations=%d items=%d", len(fake.integrations), len(fake.items))
	}
}

func TestRejectedCredentialUpdateFailsAndRemainsRetryable(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	secrets["SONARR_API_KEY"] = "rotated-key"
	fake.mu.Lock()
	fake.rejectUpdates = true
	fake.mu.Unlock()
	if err := link.Apply(context.Background(), from, to); err == nil {
		t.Fatal("HTTP 200 rejected update was reported as success")
	}
	fake.mu.Lock()
	fake.rejectUpdates = false
	fake.mu.Unlock()
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	values, _ := fake.integrations[0]["secrets"].([]any)
	value, _ := values[0].(map[string]any)
	if value["value"] != "rotated-key" {
		t.Fatalf("rejected update was marked done: %v", value)
	}
}

func TestRemovalDeletesTilesWhenAppRecordAlreadyMissing(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.apps = nil
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["kind"] != "notebook" {
			t.Fatalf("orphan tile survived: %v", item)
		}
	}
}

func TestSetupAdoptsLegacySupportedAppWithoutDuplicateTile(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists = true
	fake.adminName = "admin"
	fake.adminPassword = "pw"
	fake.step = "finish"
	fake.apps = []map[string]any{{"id": "legacy-app", "name": "Sonarr", "description": nil, "iconUrl": "https://example.test/icon.svg", "href": "http://old-host.example:8989", "pingUrl": "http://sonarr:8989"}}
	fake.items = []map[string]any{{"id": "legacy-tile", "kind": "app", "options": map[string]any{"appId": "legacy-app", "openInNewTab": true, "showTitle": true}, "integrationIds": []any{}}}
	srv := serve(t, fake)
	h := homarrH(t, srv, allSecrets())
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) {
		return []helpers.InstalledApp{{ID: "sonarr", Name: "Sonarr", URL: "http://new-host.example:8989", Service: "sonarr", ContainerPort: 8989}}, nil
	}
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 1 || fake.apps[0]["id"] != "legacy-app" || fake.apps[0]["href"] != "http://new-host.example:8989" {
		t.Fatalf("legacy App duplicated or stale: %v", fake.apps)
	}
	tiles := 0
	for _, item := range fake.items {
		if item["kind"] == "app" {
			tiles++
		}
	}
	if tiles != 1 {
		t.Fatalf("legacy tiles=%d, want one", tiles)
	}
}

func TestRemovalMigratesUniqueLegacyGeneratedWidgets(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	for key := range secrets {
		if strings.HasPrefix(key, "HOMARR_WIDGETS_") {
			delete(secrets, key)
		}
	}
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["kind"] != "notebook" {
			t.Fatalf("legacy managed item survived: %v", item)
		}
	}
}

func TestSetupCleansGenericTileWhoseAppRecordIsGone(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists = true
	fake.adminName = "admin"
	fake.adminPassword = "pw"
	fake.step = "finish"
	srv := serve(t, fake)
	h := homarrH(t, srv, allSecrets())
	installed := []helpers.InstalledApp{{ID: "gatus", Name: "Gatus", URL: "http://gatus.example", Service: "gatus", ContainerPort: 8080}}
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) { return installed, nil }
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.apps = nil
	fake.mu.Unlock()
	installed = nil
	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["kind"] == "app" {
			t.Fatalf("generic orphan tile survived: %v", item)
		}
	}
}

func TestInvalidWidgetOwnershipFailsWithoutDeletingUserWidgets(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	fake.items = append(fake.items, map[string]any{"id": "user-calendar", "kind": "calendar", "integrationIds": []any{fake.integrations[0]["id"]}, "options": map[string]any{}})
	before := len(fake.items)
	fake.mu.Unlock()
	key := ""
	for name := range secrets {
		if strings.HasPrefix(name, "HOMARR_WIDGETS_") {
			key = name
			secrets[name] = "invalid-json"
		}
	}
	if err := link.Apply(context.Background(), from, to); err == nil || !strings.Contains(err.Error(), "ownership") {
		t.Fatalf("invalid ownership reported as success: %v", err)
	}
	fake.mu.Lock()
	if len(fake.items) != before {
		t.Fatal("invalid ownership mutated widgets")
	}
	fake.mu.Unlock()
	delete(secrets, key)
	if err := link.Remove(context.Background(), from, to); err == nil || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("ambiguous legacy widgets were not protected: %v", err)
	}
	secrets[key] = "{}"
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["id"] == "user-calendar" {
			return
		}
	}
	t.Fatal("manual preserve-all recovery deleted user widget")
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

// The pinned Homarr ntfy test resolves HTTP401 without checking response.ok.
// Its accepting update fixture must not be the authority for token validity.
func TestNTFYCredentialRejectionFailsTargetedStepWithoutChangingIntegration(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "ntfy", 80, secrets)
	link := linkFor(t, "ntfy")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	other := targetH(t, srv, "jellyfin", 8096, secrets)
	if err := linkFor(t, "jellyfin").Apply(context.Background(), from, other); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal([]any{fake.apps, fake.integrations, fake.items})
	var failed helpers.StepResult
	var failureEvent events.Event
	from.Log = events.New(events.SinkFunc(func(event events.Event) {
		if event.Event == events.StepFail {
			failureEvent = event
		}
	}))
	from.Record = func(result helpers.StepResult) {
		if result.ID == "link-ntfy" {
			failed = result
		}
	}
	secrets["NTFY_HOMARR_TOKEN"] = "synthetic-invalid-token"
	if err := link.Apply(context.Background(), from, to); err == nil {
		t.Fatal("Homarr's accepting update let an invalid ntfy token through")
	}
	if failed.Status != "fail" || failed.Hint != "Run self-host setup ntfy to repair its saved Homarr token, then run self-host setup homarr." {
		t.Fatal("targeted ntfy failure lacks a supported retry hint")
	}
	if failureEvent.App != "homarr" || failureEvent.Step != "link-ntfy" || failureEvent.Credential != "admin" || failureEvent.Hint == "" {
		t.Fatal("public failure event does not identify the targeted recovery operation")
	}
	if strings.Contains(failed.Error+failed.Hint, secrets["NTFY_HOMARR_TOKEN"]) {
		t.Fatal("credential appeared in failure evidence")
	}
	after, _ := json.Marshal([]any{fake.apps, fake.integrations, fake.items})
	if string(before) != string(after) {
		t.Fatal("credential rejection changed integration or unrelated dashboard resources")
	}
	if secrets["NTFY_HOMARR_TOKEN"] != "synthetic-invalid-token" {
		t.Fatal("failed token was silently replaced")
	}
	secrets["NTFY_HOMARR_TOKEN"] = "ntfy-token"
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	if failed.Status != "skip" {
		t.Fatal("rejection changed the saved credential fingerprint")
	}
}

func TestNTFYNewTokenRequiresTheExistingAdministratorAccount(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"unauthorized", 401, `{"username":"admin","role":"admin"}`},
		{"anonymous", 200, `{"username":"*","role":"anonymous"}`},
		{"different user", 200, `{"username":"other","role":"admin"}`},
		{"nonadmin", 200, `{"username":"admin","role":"user"}`},
		{"empty account", 200, `{}`},
		{"invalid account", 200, `invalid`},
		{"redirect", 302, `{"username":"admin","role":"admin"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFake()
			fake.apiKey = "keyid.secret"
			srv := serve(t, fake)
			account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/v1/account" || r.Header.Get("Authorization") != "Bearer ntfy-token" {
					t.Error("credential probe used the wrong boundary")
				}
				w.Header().Set("Location", srv.URL+"/v1/account")
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			}))
			defer account.Close()
			secrets := allSecrets()
			from := homarrH(t, srv, secrets)
			to := targetH(t, srv, "ntfy", 80, secrets)
			to.BaseURL = account.URL
			if linkFor(t, "ntfy").Apply(context.Background(), from, to) == nil {
				t.Fatal("unverified administrator token was accepted")
			}
			if len(fake.integrations) != 0 {
				t.Fatal("unverified token was stored in Homarr")
			}
			if secrets["NTFY_HOMARR_TOKEN"] != "ntfy-token" {
				t.Fatal("configured token changed")
			}
		})
	}
}
