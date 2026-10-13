package wud

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type homarrSecrets map[string]string

func (s homarrSecrets) Get(key string) string       { return s[key] }
func (s homarrSecrets) Set(key, value string) error { s[key] = value; return nil }

func TestHomarrReaderInventoryNeverUsesAdmin(t *testing.T) {
	adminRequests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if user == "fixture-admin" {
			adminRequests++
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if !ok || user != "fixture-reader" || password != "fixture-reader-password" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/auth/user":
			json.NewEncoder(w).Encode(map[string]string{"id": "fixture-reader-id", "username": "fixture-reader", "role": "ro", "provider": "local"})
		case "/api/users":
			w.WriteHeader(http.StatusForbidden)
		case "/api/containers":
			json.NewEncoder(w).Encode([]any{map[string]any{"id": "fixture-container", "name": "fixture-container", "watcher": "approved", "updateAvailable": false}})
		default:
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	defer srv.Close()
	h := helpers.New(helpers.Config{App: "wud", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: homarrSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-admin-password", "WUD_HOMARR_USERNAME": "fixture-reader", "WUD_HOMARR_PASSWORD": "fixture-reader-password", "WUD_HOMARR_USER_ID": "fixture-reader-id"}})
	statistics, err := ReadHomarrStats(t.Context(), h)
	if err != nil || statistics.TotalContainers != 1 || adminRequests != 0 {
		t.Fatalf("Homarr must read as its selected ro identity without administrator requests: err=%v adminRequests=%d total=%d", err, adminRequests, statistics.TotalContainers)
	}
}

// The fixture implements the pinned public user API and role boundaries. It
// keeps the server's observed identity separate from the stored Project keys.
type homarrUserFixture struct {
	users map[string]struct {
		identity
		password string
	}
	creates          int
	mutations        int
	uncertain        bool
	privilegedReader bool
	beforeCreate     func()
}

func newHomarrUserFixture() *homarrUserFixture {
	f := &homarrUserFixture{users: map[string]struct {
		identity
		password string
	}{}}
	f.users["fixture-admin"] = struct {
		identity
		password string
	}{identity{ID: "fixture-admin-id", Username: "fixture-admin", Role: "admin", Provider: "local"}, "fixture-admin-password"}
	return f
}
func (f *homarrUserFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	username, password, present := r.BasicAuth()
	user, exists := f.users[username]
	if !present || !exists || user.password != password {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if r.URL.Path == "/auth/user" && r.Method == http.MethodGet {
		json.NewEncoder(w).Encode(user.identity)
		return
	}
	if r.URL.Path == "/api/users" {
		if user.Role != "admin" && !f.privilegedReader {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if r.Method == http.MethodGet {
			users := []identity{}
			for _, u := range f.users {
				users = append(users, u.identity)
			}
			json.NewEncoder(w).Encode(users)
			return
		}
		if r.Method == http.MethodPost {
			f.creates++
			if f.beforeCreate != nil {
				f.beforeCreate()
			}
			var body struct{ Username, Password, Role string }
			if json.NewDecoder(r.Body).Decode(&body) != nil || body.Role != "ro" || body.Username != homarrUsername || body.Password == "" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if _, exists := f.users[body.Username]; exists {
				w.WriteHeader(http.StatusConflict)
				return
			}
			created := identity{ID: "fixture-reader-id", Username: body.Username, Role: body.Role, Provider: "local"}
			f.users[body.Username] = struct {
				identity
				password string
			}{created, body.Password}
			if f.uncertain {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(created)
			return
		}
	}
	if r.URL.Path == "/api/containers" && r.Method == http.MethodGet {
		json.NewEncoder(w).Encode([]any{map[string]any{"id": "fixture-container", "name": "fixture-container", "watcher": "approved", "updateAvailable": false}})
		return
	}
	// Pinned container watch/delete/snooze/trigger routes permit admin/rw only.
	if user.Role != "admin" && user.Role != "rw" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	f.mutations++
	w.WriteHeader(http.StatusNoContent)
}
func (f *homarrUserFixture) helpers(t *testing.T, secrets homarrSecrets) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "wud", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: secrets})
}

func TestHomarrReaderCreationIsScopedAndReused(t *testing.T) {
	fixture := newHomarrUserFixture()
	secrets := homarrSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-admin-password"}
	h := fixture.helpers(t, secrets)
	fixture.beforeCreate = func() {
		if secrets["WUD_HOMARR_USERNAME"] != homarrUsername || secrets["WUD_HOMARR_PASSWORD"] == "" || secrets["WUD_HOMARR_PENDING"] != "true" {
			t.Fatal("account creation was not privately checkpointed before mutation")
		}
	}
	if err := setupHomarrReader(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	password := secrets["WUD_HOMARR_PASSWORD"]
	if err := setupHomarrReader(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	if fixture.creates != 1 || fixture.mutations != 0 || secrets["WUD_HOMARR_PASSWORD"] != password || secrets["WUD_HOMARR_USER_ID"] != "fixture-reader-id" || secrets["WUD_HOMARR_PENDING"] != "" {
		t.Fatal("reader creation did not preserve its recorded identity and credential")
	}
	admin := fixture.users["fixture-admin"]
	if admin.Role != "admin" || admin.password != "fixture-admin-password" {
		t.Fatal("reader provisioning changed administration")
	}
	if statistics, err := ReadHomarrStats(t.Context(), h); err != nil || statistics.TotalContainers != 1 {
		t.Fatalf("reader inventory verification failed: %v", err)
	}
	for _, path := range []string{"/api/containers/watch", "/api/containers/fixture-container/snooze", "/api/containers/fixture-container/triggers/docker/approved"} {
		response, err := h.HTTP(t.Context(), helpers.Request{Method: http.MethodPost, Path: path, User: homarrUsername, Password: password})
		if err != nil || response.Status != http.StatusForbidden {
			t.Fatalf("reader container mutation was not denied: %v", err)
		}
	}
	if fixture.mutations != 0 {
		t.Fatal("reader performed a container mutation")
	}
}

func TestHomarrReaderRejectsIdentityAndPermissionDrift(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*homarrUserFixture, homarrSecrets)
	}{
		{"administrator role", func(f *homarrUserFixture, _ homarrSecrets) {
			u := f.users[homarrUsername]
			u.Role = "admin"
			f.users[homarrUsername] = u
		}},
		{"write role", func(f *homarrUserFixture, _ homarrSecrets) {
			u := f.users[homarrUsername]
			u.Role = "rw"
			f.users[homarrUsername] = u
		}},
		{"other provider", func(f *homarrUserFixture, _ homarrSecrets) {
			u := f.users[homarrUsername]
			u.Provider = "oidc"
			f.users[homarrUsername] = u
		}},
		{"changed identity", func(f *homarrUserFixture, _ homarrSecrets) {
			u := f.users[homarrUsername]
			u.ID = "other-id"
			f.users[homarrUsername] = u
		}},
		{"missing ownership", func(_ *homarrUserFixture, s homarrSecrets) { delete(s, "WUD_HOMARR_USER_ID") }},
		{"missing password", func(_ *homarrUserFixture, s homarrSecrets) { delete(s, "WUD_HOMARR_PASSWORD") }},
		{"rejected password", func(_ *homarrUserFixture, s homarrSecrets) { s["WUD_HOMARR_PASSWORD"] = "rejected-fixture-password" }},
		{"administrator API granted", func(f *homarrUserFixture, _ homarrSecrets) { f.privilegedReader = true }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newHomarrUserFixture()
			fixture.users[homarrUsername] = struct {
				identity
				password string
			}{identity{ID: "fixture-reader-id", Username: homarrUsername, Role: "ro", Provider: "local"}, "fixture-reader-password"}
			secrets := homarrSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-admin-password", "WUD_HOMARR_USERNAME": homarrUsername, "WUD_HOMARR_PASSWORD": "fixture-reader-password", "WUD_HOMARR_USER_ID": "fixture-reader-id"}
			scenario.change(fixture, secrets)
			h := fixture.helpers(t, secrets)
			if err := VerifyHomarrReader(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("identity/permission drift should remain Manual: %v", err)
			}
			if err := createHomarrReader(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("drift caused credential replacement instead of Manual: %v", err)
			}
			if fixture.creates != 0 || fixture.mutations != 0 {
				t.Fatal("drift changed an existing account or container")
			}
		})
	}
}

func TestHomarrReaderRefusesNamedCollisionAndUncertainCreation(t *testing.T) {
	t.Run("named collision", func(t *testing.T) {
		fixture := newHomarrUserFixture()
		fixture.users[homarrUsername] = struct {
			identity
			password string
		}{identity{ID: "user-owned-id", Username: homarrUsername, Role: "ro", Provider: "local"}, "user-owned-fixture-password"}
		secrets := homarrSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-admin-password"}
		if err := createHomarrReader(t.Context(), fixture.helpers(t, secrets)); !errors.Is(err, helpers.ErrManual) {
			t.Fatalf("named collision must remain unowned: %v", err)
		}
		if fixture.creates != 0 || secrets["WUD_HOMARR_PASSWORD"] != "" {
			t.Fatal("named collision was adopted or rotated")
		}
	})
	t.Run("uncertain creation", func(t *testing.T) {
		fixture := newHomarrUserFixture()
		fixture.uncertain = true
		secrets := homarrSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-admin-password"}
		h := fixture.helpers(t, secrets)
		if err := createHomarrReader(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
			t.Fatalf("uncertain creation must remain Manual: %v", err)
		}
		password := secrets["WUD_HOMARR_PASSWORD"]
		if err := createHomarrReader(t.Context(), h); !errors.Is(err, helpers.ErrManual) {
			t.Fatalf("retry must preserve uncertain ownership: %v", err)
		}
		if fixture.creates != 1 || secrets["WUD_HOMARR_PASSWORD"] != password || secrets["WUD_HOMARR_PENDING"] != "true" || secrets["WUD_HOMARR_USER_ID"] != "" {
			t.Fatal("uncertain creation was duplicated, adopted or rotated")
		}
	})
}
