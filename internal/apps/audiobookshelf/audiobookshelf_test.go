package audiobookshelf_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/apps/audiobookshelf"
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

type fakeABS struct {
	mu           sync.Mutex
	password     string
	failInit     bool
	homarr       map[string]any
	key          string
	userCreates  int
	keyCreates   int
	keyRevoked   bool
	badLibraries bool
}

func (f *fakeABS) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"app": "audiobookshelf", "serverVersion": "2.37.0", "isInit": f.password != ""})
	})
	mux.HandleFunc("POST /init", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failInit {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		var body struct {
			NewRoot struct{ Username, Password string } `json:"newRoot"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		f.password = body.NewRoot.Password
	})
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var body struct{ Username, Password string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Username != adminUser || body.Password != f.password || f.password == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "root-id", "username": adminUser, "type": "root", "accessToken": "temporary-admin-session"}})
	})
	mux.HandleFunc("GET /api/users", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer temporary-admin-session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		users := []map[string]any{}
		if f.homarr != nil {
			users = append(users, f.homarr)
		}
		json.NewEncoder(w).Encode(map[string]any{"users": users})
	})
	mux.HandleFunc("POST /api/users", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer temporary-admin-session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewDecoder(r.Body).Decode(&f.homarr)
		delete(f.homarr, "password")
		f.homarr["id"] = "homarr-user-id"
		f.userCreates++
		json.NewEncoder(w).Encode(map[string]any{"user": f.homarr})
	})
	mux.HandleFunc("GET /api/users/homarr-user-id", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer temporary-admin-session" || f.homarr == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(f.homarr)
	})
	mux.HandleFunc("GET /api/api-keys", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer temporary-admin-session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"apiKeys": []any{}})
	})
	mux.HandleFunc("POST /api/api-keys", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer temporary-admin-session" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		body["id"] = "homarr-key-id"
		payload := base64.RawURLEncoding.EncodeToString([]byte(`{"type":"api","keyId":"homarr-key-id","name":"self-host Homarr"}`))
		f.key = "synthetic-header." + payload + ".synthetic-signature"
		body["apiKey"] = f.key
		f.keyCreates++
		json.NewEncoder(w).Encode(map[string]any{"apiKey": body})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.key == "" || f.keyRevoked || r.Header.Get("Authorization") != "Bearer "+f.key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/authorize":
			json.NewEncoder(w).Encode(map[string]any{"user": f.homarr})
		case "/api/libraries":
			if f.badLibraries {
				json.NewEncoder(w).Encode(map[string]any{})
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"libraries": []any{}})
		case "/api/me/listening-stats":
			json.NewEncoder(w).Encode(map[string]any{"totalTime": 0})
		case "/api/users/online":
			json.NewEncoder(w).Encode(map[string]any{"openSessions": []any{}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	return mux
}

func newH(t *testing.T, srv *httptest.Server, records *[]helpers.StepResult) *helpers.H {
	t.Helper()
	deps := systemtest.NewDeps(t)
	return helpers.New(helpers.Config{
		App: "audiobookshelf", Service: "audiobookshelf",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: fakeSecrets{"ADMIN_USER": adminUser, "ADMIN_PASSWORD": adminPass},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { *records = append(*records, r) },
	})
}

func TestSetupThenCheckThenRerunSkips(t *testing.T) {
	fake := &fakeABS{}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)
	ctx := context.Background()

	if err := (audiobookshelf.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (audiobookshelf.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !fake.passwordSet() {
		t.Fatal("Setup did not create the root account")
	}
	key := audiobookshelf.APIKey(h)
	if key == "" || h.Secret(h.Key("homarr_user_id")) != "homarr-user-id" || h.Secret(h.Key("homarr_api_key_id")) != "homarr-key-id" {
		t.Fatal("Setup did not persist the separate Homarr account and API key")
	}

	records = nil
	if err := (audiobookshelf.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("rerun Setup: %v", err)
	}
	for _, r := range records {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("rerun step %s = %s, want skip", r.ID, r.Status)
		}
	}
	if audiobookshelf.APIKey(h) != key || fake.userCreates != 1 || fake.keyCreates != 1 {
		t.Fatal("rerun replaced the Homarr account or API key")
	}
	fake.mu.Lock()
	fake.badLibraries = true
	fake.mu.Unlock()
	if err := (audiobookshelf.App{}).Check(ctx, h); err == nil {
		t.Fatal("Check accepted a missing library list as an empty library")
	}
	fake.mu.Lock()
	fake.badLibraries = false
	fake.keyRevoked = true
	fake.mu.Unlock()
	if err := (audiobookshelf.App{}).Check(ctx, h); err == nil {
		t.Fatal("Check accepted a revoked key after an earlier successful check")
	}
	if err := (audiobookshelf.App{}).Setup(ctx, h); err == nil {
		t.Fatal("Setup should require repair of a revoked key")
	}
	if fake.keyCreates != 1 || audiobookshelf.APIKey(h) != key {
		t.Fatal("Setup silently replaced a revoked key")
	}
}

func (f *fakeABS) passwordSet() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.password != ""
}

func TestFailingStepHintNamesTheSetupCommand(t *testing.T) {
	fake := &fakeABS{failInit: true}
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	var records []helpers.StepResult
	h := newH(t, srv, &records)

	if err := (audiobookshelf.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when /init errors")
	}
	var hint string
	for _, r := range records {
		if r.Status == stepstatus.StepFail {
			hint = r.Hint
		}
	}
	if !strings.Contains(hint, "self-host setup audiobookshelf") {
		t.Errorf("hint should name the setup command, got %q", hint)
	}
}
