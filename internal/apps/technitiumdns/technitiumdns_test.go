package technitiumdns_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/technitiumdns"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeSecrets map[string]string

func (s fakeSecrets) Get(key string) string       { return s[key] }
func (s fakeSecrets) Set(key, value string) error { s[key] = value; return nil }

const (
	adminUser = "admin"
	adminPass = "correct-horse-battery"
)

type fakeTechnitium struct {
	mu             sync.Mutex
	password       string
	homarrPassword string
	homarrToken    string
	account        bool
}

func (f *fakeTechnitium) handler() http.Handler {
	mux := http.NewServeMux()
	permissions := func(admin bool) map[string]any {
		result := map[string]any{}
		for _, section := range []string{"Dashboard", "Zones", "Cache", "Allowed", "Blocked", "Apps", "DnsClient", "Settings", "DhcpServer", "Administration", "Logs"} {
			result[section] = map[string]bool{
				"canView": admin || section != "Settings" && section != "Administration", "canModify": admin, "canDelete": admin,
			}
		}
		return result
	}
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>Technitium</html>")) })
	mux.HandleFunc("POST /api/user/login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if f.account && r.PostForm.Get("user") == "self-host-homarr" && r.PostForm.Get("pass") == f.homarrPassword {
			json.NewEncoder(w).Encode(map[string]any{
				"status": "ok", "username": "self-host-homarr", "token": "readonly-session",
				"info": map[string]any{"version": "15.5.1", "permissions": permissions(false)},
			})
			return
		}
		if r.PostForm.Get("user") != adminUser || r.PostForm.Get("pass") != f.password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"status": "ok", "username": adminUser, "token": "admin-token",
			"info": map[string]any{"version": "15.5.1", "permissions": permissions(true)},
		})
	})
	mux.HandleFunc("POST /api/user/logout", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{}})
	})
	mux.HandleFunc("GET /api/admin/users/list", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		users := []map[string]string{{"username": adminUser}}
		if f.account {
			users = append(users, map[string]string{"username": "self-host-homarr"})
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{"users": users}})
	})
	mux.HandleFunc("POST /api/admin/users/create", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.Header.Get("Authorization") != "Bearer admin-token" || f.account || r.PostForm.Get("user") != "self-host-homarr" || r.PostForm.Get("pass") == "" {
			json.NewEncoder(w).Encode(map[string]any{"status": "error"})
			return
		}
		f.account = true
		f.homarrPassword = r.PostForm.Get("pass")
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{"username": "self-host-homarr"}})
	})
	mux.HandleFunc("POST /api/admin/users/get", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.Header.Get("Authorization") != "Bearer admin-token" || !f.account || r.PostForm.Get("user") != "self-host-homarr" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{
			"username": "self-host-homarr", "type": "Local", "disabled": false, "memberOfGroups": []string{},
		}})
	})
	mux.HandleFunc("GET /api/admin/sessions/list", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer admin-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		sessions := []map[string]string{}
		if f.homarrToken != "" {
			sessions = append(sessions, map[string]string{"username": "self-host-homarr", "tokenName": "self-host Homarr statistics"})
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{"sessions": sessions}})
	})
	mux.HandleFunc("POST /api/admin/sessions/createToken", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		r.ParseForm()
		if r.Header.Get("Authorization") != "Bearer admin-token" || !f.account || f.homarrToken != "" || r.PostForm.Get("user") != "self-host-homarr" || r.PostForm.Get("tokenName") != "self-host Homarr statistics" {
			json.NewEncoder(w).Encode(map[string]any{"status": "error"})
			return
		}
		f.homarrToken = "homarr-api-token"
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{
			"username": "self-host-homarr", "tokenName": "self-host Homarr statistics", "token": f.homarrToken,
		}})
	})
	mux.HandleFunc("GET /api/user/session/get", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.homarrToken == "" || r.Header.Get("Authorization") != "Bearer "+f.homarrToken {
			json.NewEncoder(w).Encode(map[string]any{"status": "invalid-token"})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"status": "ok", "username": "self-host-homarr", "tokenName": "self-host Homarr statistics", "token": f.homarrToken,
			"info": map[string]any{"version": "15.5.1", "permissions": permissions(false)},
		})
	})
	mux.HandleFunc("GET /api/dashboard/stats/get", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.homarrToken == "" || r.Header.Get("Authorization") != "Bearer "+f.homarrToken || r.URL.Query().Get("type") != "LastHour" {
			json.NewEncoder(w).Encode(map[string]any{"status": "invalid-token"})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "response": map[string]any{"stats": map[string]int{
			"totalQueries": 0, "totalBlocked": 0, "blockedZones": 0, "blockListZones": 0,
		}}})
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "technitium-dns", Service: "technitium-dns",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeTechnitium{password: adminPass}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (technitiumdns.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (technitiumdns.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}

	records = nil
	if err := (technitiumdns.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
}

func TestFailingStepHintNamesTheStartCommand(t *testing.T) {
	fake := &fakeTechnitium{password: "a-different-password"}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (technitiumdns.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator password does not authenticate")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host start technitium-dns") {
		t.Errorf("hint should name the start command, got %q", hint)
	}
}
