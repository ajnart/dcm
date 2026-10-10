package homarr_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

// fakeHomarr models exactly the endpoints Homarr Setup, Check and the Links
// use, including the claim cookie, the administrator session and the
// integration connection test.
type fakeHomarr struct {
	mu                     sync.Mutex
	adminExists            bool
	adminName              string
	adminPassword          string
	step                   string
	claimToken             string
	sessionToken           string
	apiKey                 string
	apps                   []map[string]any
	integrations           []map[string]any
	items                  []map[string]any
	sections               []any
	layouts                []any
	boards                 []map[string]any
	readBoard              string
	itemPosts              int
	assistantPosts         int
	rejectAssistantStatus  int
	rejectAssistantMessage string
	rejectAssistantIssues  []any
	rejectUpdates          bool
	nextID                 int
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
		f.itemPosts++
		if body["kind"] == "assistant" {
			f.assistantPosts++
		}
		if body["kind"] == "assistant" && f.rejectAssistantStatus != 0 {
			w.WriteHeader(f.rejectAssistantStatus)
			json.NewEncoder(w).Encode(map[string]any{"message": f.rejectAssistantMessage, "issues": f.rejectAssistantIssues})
			return
		}
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
			"sections": sections, "layouts": f.layouts, "items": items,
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
	if apps != 1 || integrations != 1 || items != 6 {
		t.Fatalf("apps=%d integrations=%d items=%d, want 1/1/6", apps, integrations, items)
	}

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	fake.mu.Lock()
	apps, integrations, items = len(fake.apps), len(fake.integrations), len(fake.items)
	fake.mu.Unlock()
	if apps != 1 || integrations != 1 || items != 6 {
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
	if apps != 1 || items != 3 || integrations != 0 {
		t.Fatalf("tile-only: apps=%d items=%d integrations=%d, want 1/3/0", apps, items, integrations)
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
				if kind == "app" || kind == "notebook" || kind == "assistant" {
					continue
				}
				size, _ := item["size"].(map[string]any)
				expectedWidth := float64(4)
				expectedHeight := float64(3)
				if kind == "mediaServer" {
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

func beszelHub(t *testing.T, systems ...map[string]string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/collections/users/auth-with-password", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if body["identity"] != "admin@selfhost.local" || body["password"] != "pw" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"token":  "hub-session",
			"record": map[string]string{"email": "admin@selfhost.local", "role": "admin"},
		})
	})
	mux.HandleFunc("GET /api/collections/systems/records", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "hub-session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"items": systems})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func beszelTarget(t *testing.T, hub *httptest.Server) *helpers.H {
	t.Helper()
	return targetH(t, hub, "beszel", 8090, allSecrets())
}

func TestBeszelLinkCreatesTheIntegrationAndOneSystemStatsWidgetBoundToThisMachine(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	hub := beszelHub(t, map[string]string{"id": "other0000000001", "name": "Another box"}, map[string]string{"id": "abc123def456789", "name": "This machine"})
	from := homarrH(t, srv, allSecrets())

	if err := linkFor(t, "beszel").Apply(context.Background(), from, beszelTarget(t, hub)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.integrations) != 1 {
		t.Fatalf("integrations=%d, want 1", len(fake.integrations))
	}
	integration := fake.integrations[0]
	if integration["kind"] != "beszel" || integration["url"] != "http://beszel:8090" {
		t.Fatalf("integration=%v:%v, want beszel at http://beszel:8090", integration["kind"], integration["url"])
	}
	got := map[string]string{}
	secrets, _ := integration["secrets"].([]any)
	for _, raw := range secrets {
		record, _ := raw.(map[string]any)
		got[record["kind"].(string)], _ = record["value"].(string)
	}
	if len(got) != 2 || got["username"] != "admin@selfhost.local" || got["password"] != "pw" {
		t.Fatalf("secrets carry %d kinds, want username admin@selfhost.local and the Admin password", len(got))
	}
	integrationID, _ := integration["id"].(string)
	if n := widgetCount(fake.items, "beszelSystemStats", integrationID); n != 1 {
		t.Fatalf("System Stats widgets=%d, want 1", n)
	}
	for _, item := range fake.items {
		if item["kind"] != "beszelSystemStats" {
			continue
		}
		options, _ := item["options"].(map[string]any)
		if want := integrationID + ":abc123def456789"; options["systemId"] != want {
			t.Fatalf("systemId=%v, want %s", options["systemId"], want)
		}
		if options["showCpu"] != true || options["showMemory"] != true {
			t.Fatalf("options=%v, want the charts switched on", options)
		}
	}
}

func TestBeszelLinkBindsTheWidgetToTheStoredSystemWhateverItIsCalled(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	hub := beszelHub(t, map[string]string{"id": "other0000000001", "name": "This machine"}, map[string]string{"id": "abc123def456789", "name": "Home server"})
	from := homarrH(t, srv, allSecrets())
	secrets := allSecrets()
	secrets["BESZEL_MACHINE_ID"] = "abc123def456789"

	if err := linkFor(t, "beszel").Apply(context.Background(), from, targetH(t, hub, "beszel", 8090, secrets)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	integrationID, _ := fake.integrations[0]["id"].(string)
	for _, item := range fake.items {
		if item["kind"] != "beszelSystemStats" {
			continue
		}
		options, _ := item["options"].(map[string]any)
		if want := integrationID + ":abc123def456789"; options["systemId"] != want {
			t.Fatalf("systemId=%v, want %s", options["systemId"], want)
		}
		return
	}
	t.Fatal("no System Stats widget was created")
}

type recorded struct {
	mu     sync.Mutex
	events []events.Event
}

func (r *recorded) Emit(e events.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func TestBeszelLinkNeverShowsTheAdminPassword(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	hub := beszelHub(t, map[string]string{"id": "abc123def456789", "name": "This machine"})
	log := &recorded{}
	var steps []helpers.StepResult
	deps := systemtest.NewDeps(t)
	from := helpers.New(helpers.Config{
		App: "homarr", Service: "homarr", BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: allSecrets(), Log: events.New(log), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { steps = append(steps, r) },
	})
	link := linkFor(t, "beszel")

	if err := link.Apply(context.Background(), from, beszelTarget(t, hub)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if err := link.Remove(context.Background(), from, beszelTarget(t, hub)); err != nil {
		t.Fatalf("remove: %v", err)
	}
	log.mu.Lock()
	seen, _ := json.Marshal([]any{log.events, steps})
	log.mu.Unlock()
	if len(steps) == 0 {
		t.Fatal("the Link recorded no steps")
	}
	if strings.Contains(string(seen), `"pw"`) || strings.Contains(string(seen), "hub-session") {
		t.Fatalf("a credential reached the events or step results: %.80s", seen)
	}
}

func TestBeszelLinkRerunKeepsOneIntegrationAndOneWidget(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	hub := beszelHub(t, map[string]string{"id": "abc123def456789", "name": "This machine"})
	from := homarrH(t, srv, allSecrets())
	link := linkFor(t, "beszel")
	for range 2 {
		if err := link.Apply(context.Background(), from, beszelTarget(t, hub)); err != nil {
			t.Fatalf("apply: %v", err)
		}
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	integrationID, _ := fake.integrations[0]["id"].(string)
	if len(fake.integrations) != 1 || widgetCount(fake.items, "beszelSystemStats", integrationID) != 1 {
		t.Fatalf("integrations=%d widgets=%d, want 1/1", len(fake.integrations), widgetCount(fake.items, "beszelSystemStats", integrationID))
	}
}

func TestBeszelLinkFailsWhenTheHubDoesNotListThisMachine(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	hub := beszelHub(t, map[string]string{"id": "other0000000001", "name": "Another box"})
	from := homarrH(t, srv, allSecrets())

	if err := linkFor(t, "beszel").Apply(context.Background(), from, beszelTarget(t, hub)); err == nil {
		t.Fatal("a Hub without this machine must fail the Link")
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, item := range fake.items {
		if item["kind"] == "beszelSystemStats" {
			t.Fatal("a widget was created without a system to show")
		}
	}
}

func TestBeszelLinkRemoveDeletesTheTileIntegrationAndWidget(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	hub := beszelHub(t, map[string]string{"id": "abc123def456789", "name": "This machine"})
	from := homarrH(t, srv, allSecrets())
	link := linkFor(t, "beszel")
	if err := link.Apply(context.Background(), from, beszelTarget(t, hub)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if err := link.Remove(context.Background(), from, beszelTarget(t, hub)); err != nil {
		t.Fatalf("remove: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 0 || len(fake.integrations) != 0 {
		t.Fatalf("apps=%d integrations=%d, want both removed", len(fake.apps), len(fake.integrations))
	}
	for _, item := range fake.items {
		if item["kind"] == "beszelSystemStats" || item["kind"] == "app" {
			t.Fatalf("a %v item survived removal", item["kind"])
		}
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
	radarr := linkFor(t, "radarr")
	radarrH := targetH(t, srv, "radarr", 7878, allSecrets())
	if err := radarr.Apply(context.Background(), from, radarrH); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	before := len(fake.items)
	fake.mu.Unlock()

	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	if err := radarr.Apply(context.Background(), from, radarrH); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	after := len(fake.items)
	for _, kind := range []string{"stats", "calendar"} {
		count := 0
		for _, item := range fake.items {
			if item["kind"] == kind {
				count++
				ids, _ := item["integrationIds"].([]any)
				if len(ids) != 2 {
					t.Errorf("%s integrations=%d, want 2", kind, len(ids))
				}
			}
		}
		if count != 1 {
			t.Errorf("%s widgets=%d, want one shared widget", kind, count)
		}
	}
	fake.mu.Unlock()
	if err := link.Remove(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	for _, item := range fake.items {
		if item["kind"] != "stats" && item["kind"] != "calendar" {
			continue
		}
		ids, _ := item["integrationIds"].([]any)
		if len(ids) != 1 || ids[0] != fake.integrations[0]["id"] {
			t.Errorf("removal broke remaining shared widget: %v", item)
		}
	}
	fake.mu.Unlock()
	if err := radarr.Apply(context.Background(), from, radarrH); err != nil {
		t.Fatal(err)
	}
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

func TestDedicatedLinkUsesInventoryNavigationAndKeepsLocalEndpoints(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	srv := serve(t, fake)
	from := homarrH(t, srv, allSecrets())
	from.URL = "https://homarr-2.example.ts.net"
	to := targetH(t, srv, "sonarr", 8989, allSecrets())
	local := to.URL
	browser := "https://sonarr-2.example.ts.net/custom/path?view=all"
	from.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) {
		return []helpers.InstalledApp{{ID: "sonarr", URL: browser, Service: "sonarr", ContainerPort: 8989}}, nil
	}
	link := linkFor(t, "sonarr")
	for _, address := range []string{browser, "https://sonarr.example.com/custom/path?view=all", "http://sonarr.192-168-1-20.sslip.io/custom/path?view=all", local} {
		browser = address
		if err := link.Apply(t.Context(), from, to); err != nil {
			t.Fatal(err)
		}
		fake.mu.Lock()
		if len(fake.apps) != 1 || fake.apps[0]["href"] != address || fake.apps[0]["pingUrl"] != "http://sonarr:8989" {
			t.Fatalf("browser tile or ping endpoint = %v", fake.apps)
		}
		if len(fake.integrations) != 1 || fake.integrations[0]["url"] != "http://sonarr:8989" {
			t.Fatalf("integration endpoint = %v", fake.integrations)
		}
		fake.mu.Unlock()
		if to.URL != local || to.BaseURL != srv.URL || from.BaseURL != srv.URL {
			t.Fatal("navigation changed local API metadata")
		}
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
		if item["kind"] != "notebook" && item["kind"] != "assistant" {
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
	if !strings.Contains(content, "Gatus") || !strings.Contains(content, "Valkey") || !strings.Contains(content, "No browser endpoint") {
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
		if item["kind"] != "notebook" && item["kind"] != "assistant" {
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
	if len(fake.integrations) != 1 || len(fake.items) != 6 {
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
		if item["kind"] != "notebook" && item["kind"] != "assistant" {
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
		if item["kind"] != "notebook" && item["kind"] != "assistant" {
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
	for _, want := range []string{"Your homelab at a glance", ">Sonarr</a>", ">qBittorrent</a>", "self-host credentials", "<table>", "<th><p>Service</p></th>", "Homarr assistant"} {
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
	if failed.Status != stepstatus.StepFail || failed.Hint != "Run self-host setup ntfy to repair its saved Homarr token, then run self-host setup homarr." {
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
	if failed.Status != stepstatus.StepSkip {
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

func TestSetupAddsMissingAssistantToCurrentNotebookOnce(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists, fake.adminName, fake.adminPassword, fake.step = true, "admin", "pw", "finish"
	srv := serve(t, fake)
	secrets := allSecrets()
	if err := (homarr.App{}).Setup(context.Background(), homarrH(t, srv, secrets)); err != nil {
		t.Fatal(err)
	}
	fake.items = notebooks(fake.items)
	fake.itemPosts, fake.assistantPosts = 0, 0
	for run := 1; run <= 2; run++ {
		if err := (homarr.App{}).Setup(context.Background(), homarrH(t, srv, secrets)); err != nil {
			t.Fatalf("Setup run %d: %v", run, err)
		}
		if fake.assistantPosts != 1 || fake.itemPosts != 1 || len(fake.items) != 2 {
			t.Fatalf("Setup run %d: want exactly one assistant POST and two items, got assistant POSTs=%d, item POSTs=%d, items=%d", run, fake.assistantPosts, fake.itemPosts, len(fake.items))
		}
	}
}

func TestSetupWithoutAssistantKindKeepsNotebookCurrent(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists, fake.adminName, fake.adminPassword, fake.step = true, "admin", "pw", "finish"
	fake.rejectAssistantStatus, fake.rejectAssistantMessage = http.StatusBadRequest, "Unknown widget kind: assistant"
	srv := serve(t, fake)
	secrets := allSecrets()
	for run := 0; run < 2; run++ {
		h := homarrH(t, srv, secrets)
		var status stepstatus.Step
		h.Record = func(result helpers.StepResult) {
			if result.ID == "notebook" {
				status = result.Status
			}
		}
		if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
			t.Fatalf("Setup run %d without assistant kind: %v", run+1, err)
		}
		if fake.assistantPosts != run+1 {
			t.Fatalf("Setup run %d: want one rejected assistant POST per Setup, got %d total", run+1, fake.assistantPosts)
		}
		if run == 1 && status != stepstatus.StepSkip {
			t.Fatalf("notebook was not current on rerun: %s", status)
		}
	}
	if len(notebooks(fake.items)) != 1 || len(fake.items) != 1 {
		t.Fatalf("want one current notebook without assistant, got %v", fake.items)
	}
}

func TestLinksAdoptLegacyPerAppWidgets(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	secrets := allSecrets()
	for _, appID := range []string{"sonarr", "radarr"} {
		id := "legacy-" + appID
		fake.integrations = append(fake.integrations, map[string]any{"id": id, "kind": appID, "url": "http://" + appID + ":" + map[string]string{"sonarr": "8989", "radarr": "7878"}[appID]})
		secrets["HOMARR_LINKED_"+strings.ToUpper(appID)] = id
		metrics := []string{"shows", "downloaded", "missing", "queued"}
		if appID == "radarr" {
			metrics[0] = "movies"
		}
		entries := []any{}
		for _, metric := range metrics {
			sum := sha256.Sum256([]byte(metric))
			entries = append(entries, map[string]any{"id": "auto-stack-" + hex.EncodeToString(sum[:])[:32], "integrationId": id, "metric": metric, "label": "", "hidden": false, "compact": false})
		}
		for _, kind := range []string{"calendar", "mediaMissing", "stats"} {
			options := map[string]any{}
			if kind == "stats" {
				options["entries"] = entries
			}
			fake.items = append(fake.items, map[string]any{"id": id + "-" + kind, "kind": kind, "options": options, "integrationIds": []any{id}, "size": map[string]any{"width": 1, "height": 1}})
		}
	}
	fake.items = append(fake.items, map[string]any{"id": "user-calendar", "kind": "calendar", "options": map[string]any{"custom": true}, "integrationIds": []any{}, "size": map[string]any{"width": 2, "height": 3}})
	srv := serve(t, fake)
	from := homarrH(t, srv, secrets)
	for _, target := range []struct {
		id   string
		port int
	}{{"sonarr", 8989}, {"radarr", 7878}} {
		if err := linkFor(t, target.id).Apply(context.Background(), from, targetH(t, srv, target.id, target.port, secrets)); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{"calendar", "stats"} {
		for _, id := range []string{"legacy-sonarr", "legacy-radarr"} {
			if count := widgetCount(fake.items, kind, id); count != 1 {
				t.Fatalf("%s for %s: got %d widgets, want one", kind, id, count)
			}
		}
		count := 0
		for _, item := range fake.items {
			if item["kind"] != kind || item["id"] == "user-calendar" {
				continue
			}
			count++
			ids := item["integrationIds"].([]any)
			if len(ids) != 2 {
				t.Fatalf("legacy %s not consolidated: %v", kind, item)
			}
			if kind == "stats" {
				entries := item["options"].(map[string]any)["entries"].([]any)
				seen := map[string]bool{}
				for _, raw := range entries {
					id := raw.(map[string]any)["id"].(string)
					if seen[id] {
						t.Fatal("duplicate stats entry ID")
					}
					seen[id] = true
				}
				if len(entries) != 8 {
					t.Fatalf("got %d stats entries, want 8", len(entries))
				}
			}
		}
		if count != 1 {
			t.Fatalf("got %d managed %s widgets, want one", count, kind)
		}
	}
	for _, id := range []string{"legacy-sonarr", "legacy-radarr"} {
		var owned map[string]bool
		if err := json.Unmarshal([]byte(secrets["HOMARR_WIDGETS_"+strings.ToUpper(strings.ReplaceAll(id, "-", "_"))]), &owned); err != nil {
			t.Fatal(err)
		}
		if !owned["legacy-sonarr-calendar"] || !owned["legacy-sonarr-stats"] || owned["legacy-radarr-calendar"] || owned["legacy-radarr-stats"] {
			t.Fatalf("incorrect shared ownership: %v", owned)
		}
	}
	for _, item := range fake.items {
		if item["id"] == "user-calendar" && item["options"].(map[string]any)["custom"] == true {
			return
		}
	}
	t.Fatal("user calendar was changed or removed")
}

func TestSharedWidgetResizeRelocatesWithoutMovingUserItems(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.layouts = []any{map[string]any{"id": "desktop", "columnCount": 6}, map[string]any{"id": "mobile", "columnCount": 2}}
	fake.sections = []any{map[string]any{"id": "root", "kind": "section", "xOffset": 0}}
	srv := serve(t, fake)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "sonarr", 8989, secrets)
	link := linkFor(t, "sonarr")
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	for _, item := range fake.items {
		if item["kind"] == "stats" {
			delete(item, "size")
			item["layouts"] = []any{
				map[string]any{"layoutId": "desktop", "sectionId": "root", "xOffset": 2, "yOffset": 0, "width": 4, "height": 2},
				map[string]any{"layoutId": "mobile", "sectionId": "root", "xOffset": 0, "yOffset": 0, "width": 2, "height": 1},
			}
		}
	}
	user := map[string]any{"id": "user-item", "kind": "notebook", "options": map[string]any{"content": "My notes"}, "layouts": []any{
		map[string]any{"layoutId": "desktop", "sectionId": "root", "xOffset": 3, "yOffset": 2, "width": 2, "height": 2},
		map[string]any{"layoutId": "mobile", "sectionId": "root", "xOffset": 0, "yOffset": 1, "width": 2, "height": 2},
	}}
	fake.items = append(fake.items, user)
	before, _ := json.Marshal(user)
	fake.mu.Unlock()
	if err := link.Apply(context.Background(), from, to); err != nil {
		t.Fatal(err)
	}
	for _, item := range fake.items {
		if item["id"] == "user-item" {
			after, _ := json.Marshal(item)
			if string(before) != string(after) {
				t.Fatal("user item moved or changed")
			}
		}
		if item["kind"] != "stats" {
			continue
		}
		for _, raw := range item["layouts"].([]any) {
			placement := raw.(map[string]any)
			want := map[string][]float64{"desktop": {2, 4, 4, 3}, "mobile": {0, 3, 2, 3}}[placement["layoutId"].(string)]
			for i, key := range []string{"xOffset", "yOffset", "width", "height"} {
				if fmt.Sprint(placement[key]) != fmt.Sprint(want[i]) {
					t.Fatalf("%s placement %s=%v, want %v", placement["layoutId"], key, placement[key], want[i])
				}
			}
		}
	}
	beforeRerun, _ := json.Marshal(fake.items)
	fresh := homarrH(t, srv, secrets)
	var status stepstatus.Step
	fresh.Record = func(result helpers.StepResult) {
		if result.ID == "link-sonarr" {
			status = result.Status
		}
	}
	if err := link.Apply(context.Background(), fresh, to); err != nil {
		t.Fatal(err)
	}
	afterRerun, _ := json.Marshal(fake.items)
	if status != stepstatus.StepSkip || string(beforeRerun) != string(afterRerun) {
		t.Fatal("rerun was not current or moved board items")
	}
}

func TestSetupWithoutAssistantEnumKeepsNotebookCurrent(t *testing.T) {
	for _, code := range []string{"invalid_value", "invalid_enum_value"} {
		t.Run(code, func(t *testing.T) {
			fake := newFake()
			fake.apiKey = "keyid.secret"
			fake.adminExists, fake.adminName, fake.adminPassword, fake.step = true, "admin", "pw", "finish"
			fake.rejectAssistantStatus, fake.rejectAssistantMessage = http.StatusBadRequest, "Input validation failed"
			issue := map[string]any{"code": code, "path": []any{"kind"}}
			if code == "invalid_value" {
				issue["values"] = []any{"app", "notebook", "stats"}
			} else {
				issue["options"] = []any{"app", "notebook", "stats"}
				issue["received"] = "assistant"
			}
			fake.rejectAssistantIssues = []any{issue}
			srv := serve(t, fake)
			secrets := allSecrets()
			for run := 0; run < 2; run++ {
				if err := (homarr.App{}).Setup(context.Background(), homarrH(t, srv, secrets)); err != nil {
					t.Fatalf("Setup run %d without assistant enum: %v", run+1, err)
				}
				if fake.assistantPosts != run+1 {
					t.Fatalf("Setup run %d: want one rejected assistant POST per Setup, got %d total", run+1, fake.assistantPosts)
				}
			}
			if len(notebooks(fake.items)) != 1 || len(fake.items) != 1 {
				t.Fatalf("want one notebook, got %v", fake.items)
			}
		})
	}
}

func TestSetupAssistantRejectionFormats(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		message     string
		issues      []any
		unsupported bool
	}{
		{"unknown-kind", 400, "Unknown widget kind: assistant", nil, true},
		{"unknown-kind-case", 400, "Unknown widget kind: ASSISTANT", nil, true},
		{"zod-values", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"kind"}, "values": []any{"notebook"}}}, true},
		{"zod-options", 400, "Input validation failed", []any{map[string]any{"code": "invalid_enum_value", "path": []any{"kind"}, "options": []any{"notebook"}, "received": "assistant"}}, true},
		{"enum-wrong-received", 400, "Input validation failed", []any{map[string]any{"code": "invalid_enum_value", "path": []any{"kind"}, "values": []any{"notebook"}, "received": "app"}}, false},
		{"enum-missing-received", 400, "Input validation failed", []any{map[string]any{"code": "invalid_enum_value", "path": []any{"kind"}, "values": []any{"notebook"}}}, false},
		{"empty-kinds", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"kind"}, "values": []any{}}}, false},
		{"nested-path", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"item", "kind"}, "values": []any{"notebook"}}}, false},
		{"multiple-issues", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"kind"}, "values": []any{"notebook"}}, map[string]any{"code": "invalid_type", "path": []any{"boardId"}}}, false},
		{"wrong-code", 400, "Input validation failed", []any{map[string]any{"code": "invalid_type", "path": []any{"kind"}, "values": []any{"notebook"}}}, false},
		{"kind-offered", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"kind"}, "values": []any{"notebook", "assistant"}}}, false},
		{"wrong-kind", 400, "Unknown widget kind: notebook", nil, false},
		{"permission", 403, "Unknown widget kind: assistant", nil, false},
		{"server", 500, "Unknown widget kind: assistant", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFake()
			fake.apiKey = "keyid.secret"
			fake.adminExists, fake.adminName, fake.adminPassword, fake.step = true, "admin", "pw", "finish"
			fake.rejectAssistantStatus, fake.rejectAssistantMessage, fake.rejectAssistantIssues = tc.status, tc.message, tc.issues
			srv := serve(t, fake)
			err := (homarr.App{}).Setup(context.Background(), homarrH(t, srv, allSecrets()))
			if tc.unsupported {
				if err != nil || len(notebooks(fake.items)) != 1 || fake.assistantPosts != 1 {
					t.Fatalf("unsupported kind should keep notebook current after one attempt: err=%v, notebooks=%d, assistant POSTs=%d", err, len(notebooks(fake.items)), fake.assistantPosts)
				}
			} else if err == nil || len(notebooks(fake.items)) != 0 {
				t.Fatalf("other rejection should fail before notebook creation: err=%v, notebooks=%d", err, len(notebooks(fake.items)))
			}
		})
	}
}

func TestSetupDoesNotIgnoreOtherAssistantFailures(t *testing.T) {
	for _, failure := range []struct {
		name    string
		status  int
		message string
		issues  []any
	}{
		{"missing-item-id", 200, "Invalid creation response", nil},
		{"permission", 403, "Unknown widget kind: assistant", nil},
		{"server", 500, "Unknown widget kind: assistant", nil},
		{"other-kind", 400, "Unknown widget kind: notebook", nil},
		{"other-validation", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"boardId"}, "values": []any{"board-1"}}}},
		{"kind-offered", 400, "Input validation failed", []any{map[string]any{"code": "invalid_value", "path": []any{"kind"}, "values": []any{"notebook", "assistant"}}}},
	} {
		t.Run(failure.name, func(t *testing.T) {
			fake := newFake()
			fake.apiKey = "keyid.secret"
			fake.adminExists, fake.adminName, fake.adminPassword, fake.step = true, "admin", "pw", "finish"
			fake.rejectAssistantStatus, fake.rejectAssistantMessage, fake.rejectAssistantIssues = failure.status, failure.message, failure.issues
			srv := serve(t, fake)
			if err := (homarr.App{}).Setup(context.Background(), homarrH(t, srv, allSecrets())); err == nil {
				t.Fatal("assistant API failure was ignored")
			}
			if len(notebooks(fake.items)) != 0 {
				t.Fatal("published notebook after assistant API failure")
			}
		})
	}
}

func TestSetupGivesAnExtraAppATileThatPingsItsService(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fake.adminExists = true
	fake.adminName = "admin"
	fake.adminPassword = "pw"
	fake.step = "finish"
	srv := serve(t, fake)
	h := homarrH(t, srv, allSecrets())
	h.InstalledApps = func(context.Context) ([]helpers.InstalledApp, error) {
		return []helpers.InstalledApp{{ID: "whoami", Name: "whoami", URL: "http://host.example:8099", Service: "whoami", ContainerPort: 80}}, nil
	}

	if err := (homarr.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}

	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.apps) != 1 || fake.apps[0]["name"] != "whoami" || fake.apps[0]["href"] != "http://host.example:8099" || fake.apps[0]["pingUrl"] != "http://whoami:80" {
		t.Fatalf("extra App tile = %v", fake.apps)
	}
}
