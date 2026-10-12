package paperlessngx_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/paperlessngx"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakePaperless struct {
	reject           bool
	user             map[string]any
	key              string
	creates          int
	tokenRequests    int
	mutations        int
	userStatus       int
	profileStatus    int
	profileOwner     string
	malformedUser    bool
	malformedProfile bool
	statisticsStatus int
	malformedCounts  bool
}

func (f *fakePaperless) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /api/users/", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		users := []map[string]any{}
		if r.URL.Query().Get("username") == "admin" {
			users = append(users, map[string]any{"id": 1, "username": "admin", "is_superuser": true, "is_active": true})
		} else if f.user != nil && r.URL.Query().Get("username") == f.user["username"] {
			users = append(users, f.user)
		}
		json.NewEncoder(w).Encode(map[string]any{"results": users})
	})
	mux.HandleFunc("GET /api/users/{id}/", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if f.reject || !ok || user != "admin" || pass != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.userStatus != 0 {
			w.WriteHeader(f.userStatus)
			return
		}
		if f.user == nil || r.PathValue("id") != "2" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if f.malformedUser {
			w.Write([]byte(`{"id":2}`))
			return
		}
		json.NewEncoder(w).Encode(f.user)
	})
	mux.HandleFunc("POST /api/users/", func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "admin" || pass != "adminpass" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&f.user); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.creates++
		f.user["id"] = 2
		f.user["is_mfa_enabled"] = false
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(f.user)
	})
	mux.HandleFunc("/api/users/", func(w http.ResponseWriter, r *http.Request) {
		f.mutations++
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	mux.HandleFunc("POST /api/token/", func(w http.ResponseWriter, r *http.Request) {
		f.tokenRequests++
		var login map[string]string
		if err := json.NewDecoder(r.Body).Decode(&login); err != nil || f.user == nil || login["username"] != f.user["username"] || login["password"] != f.user["password"] {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.key == "" {
			f.key = "synthetic-paperless-token"
		}
		json.NewEncoder(w).Encode(map[string]string{"token": f.key})
	})
	mux.HandleFunc("GET /api/profile/", func(w http.ResponseWriter, r *http.Request) {
		if f.profileStatus != 0 {
			w.WriteHeader(f.profileStatus)
			return
		}
		user, pass, ok := r.BasicAuth()
		basic := ok && f.user != nil && user == f.user["username"] && pass == f.user["password"]
		token := f.key != "" && r.Header.Get("Authorization") == "Token "+f.key
		if f.user == nil || f.user["is_active"] != true || f.user["is_mfa_enabled"] != false || (!basic && !token) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if f.malformedProfile {
			w.Write([]byte(`{"auth_token":true}`))
			return
		}
		owner := f.user["first_name"]
		if f.profileOwner != "" && token {
			owner = f.profileOwner
		}
		var current any
		if f.key != "" {
			current = f.key
		}
		json.NewEncoder(w).Encode(map[string]any{
			"auth_token": current, "first_name": owner, "is_mfa_enabled": false, "has_usable_password": true,
		})
	})
	for _, path := range []string{"/api/statistics/", "/api/tags/", "/api/correspondents/", "/api/document_types/"} {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, r *http.Request) {
			if f.key == "" || r.Header.Get("Authorization") != "Token "+f.key {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if path == "/api/statistics/" {
				if f.statisticsStatus != 0 {
					w.WriteHeader(f.statisticsStatus)
					return
				}
				if f.malformedCounts {
					w.Write([]byte(`{"documents_total":1}`))
					return
				}
				json.NewEncoder(w).Encode(map[string]int{"documents_total": 1, "documents_inbox": 1})
				return
			}
			json.NewEncoder(w).Encode(map[string]int{"count": 1})
		})
	}
	return mux
}

type fakeSecrets struct {
	values           map[string]string
	accountWrites    int
	failAccountWrite int
}

func (s *fakeSecrets) Get(key string) string { return s.values[key] }
func (s *fakeSecrets) Set(key, value string) error {
	if key == "PAPERLESS_NGX_HOMARR_ACCOUNT" {
		s.accountWrites++
		if s.accountWrites == s.failAccountWrite {
			return errors.New("synthetic checkpoint write failure")
		}
	}
	s.values[key] = value
	return nil
}

func newH(t *testing.T, srv *httptest.Server) (*helpers.H, *[]helpers.StepResult) {
	t.Helper()
	deps := systemtest.NewDeps(t)
	var recorded []helpers.StepResult
	h := helpers.New(helpers.Config{
		App: "paperless-ngx", Service: "paperless-ngx",
		BaseURL: srv.URL, URL: srv.URL, HTTP: srv.Client(),
		Secrets: &fakeSecrets{values: map[string]string{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "adminpass"}},
		Log:     events.Discard(), Now: deps.Now, Sleep: deps.Sleep,
		Record: func(r helpers.StepResult) { recorded = append(recorded, r) },
	})
	return h, &recorded
}

func TestSetupThenCheckPass(t *testing.T) {
	fake := &fakePaperless{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()

	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("Setup: %v", err)
	}
	if err := (paperlessngx.App{}).Check(ctx, h); err != nil {
		t.Fatalf("Check: %v", err)
	}
	for _, r := range *recorded {
		if r.Status == stepstatus.StepFail {
			t.Errorf("step %s failed: %s", r.ID, r.Error)
		}
	}
	var account struct {
		ID    int    `json:"id"`
		Owner string `json:"owner"`
	}
	if err := json.Unmarshal([]byte(h.Secret(h.Key("homarr_account"))), &account); err != nil || account.ID != 2 || account.Owner == "" || fake.user["first_name"] != account.Owner {
		t.Fatal("Setup did not checkpoint the returned account ID and ownership marker")
	}
	if fake.creates != 1 || fake.tokenRequests != 1 || fake.mutations != 0 {
		t.Fatal("Setup did not create exactly one dedicated account/token without other account mutations")
	}

	partialFake := &fakePaperless{}
	partialServer := httptest.NewServer(partialFake.handler())
	defer partialServer.Close()
	partial, partialSteps := newH(t, partialServer)
	partial.Secrets.(*fakeSecrets).failAccountWrite = 2
	if err := (paperlessngx.App{}).Setup(ctx, partial); !errors.Is(err, helpers.ErrStepFailed) {
		t.Fatal("a failed identity checkpoint write must remain a failed step")
	}
	creates, tokens := partialFake.creates, partialFake.tokenRequests
	if err := (paperlessngx.App{}).Setup(ctx, partial); !errors.Is(err, helpers.ErrManual) || errors.Is(err, helpers.ErrStepFailed) {
		t.Fatal("a pending checkpoint must require Manual review instead of recreating an account")
	}
	if partialFake.creates != creates || partialFake.tokenRequests != tokens || partialFake.mutations != 0 || (*partialSteps)[len(*partialSteps)-1].Status != stepstatus.StepManual {
		t.Fatal("retrying a partial identity write mutated accounts or lost its Manual step")
	}
}

func TestRerunSkipsEveryStep(t *testing.T) {
	fake := &fakePaperless{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	h, recorded := newH(t, srv)
	ctx := context.Background()
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("first Setup: %v", err)
	}

	*recorded = nil
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("second Setup: %v", err)
	}
	for _, r := range *recorded {
		if r.Status != stepstatus.StepSkip {
			t.Errorf("step %s = %s on rerun, want skip", r.ID, r.Status)
		}
	}
	account, key := h.Secret(h.Key("homarr_account")), h.Secret(h.Key("api_key"))
	fake.user["username"] = "renamed-owned-user"
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("renamed owner Setup: %v", err)
	}
	if h.Secret(h.Key("homarr_user")) != "renamed-owned-user" || h.Secret(h.Key("homarr_account")) != account || h.Secret(h.Key("api_key")) != key {
		t.Fatal("account rename changed the canonical identity/token or lost the current username")
	}
	if err := h.SetSecret(h.Key("homarr_user"), ""); err != nil {
		t.Fatal(err)
	}
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil || h.Secret(h.Key("homarr_user")) != "renamed-owned-user" {
		t.Fatal("lost username was not recovered from the verified recorded account ID")
	}
	if err := h.SetSecret(h.Key("api_key"), "synthetic-stale-token"); err != nil {
		t.Fatal(err)
	}
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil || h.Secret(h.Key("api_key")) != key {
		t.Fatal("stale saved token was not recovered from the same verified account")
	}

	if err := h.SetSecret(h.Key("homarr_account"), ""); err != nil {
		t.Fatal(err)
	}
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("legacy name/token metadata without canonical ownership must remain Manual")
	}
	if h.Secret(h.Key("homarr_account")) != "" || h.Secret(h.Key("api_key")) != key {
		t.Fatal("uncertain legacy ownership was adopted or its token replaced")
	}
	if err := h.SetSecret(h.Key("homarr_account"), `{"id":3,"owner":"synthetic-uncertain-owner"}`); err != nil {
		t.Fatal(err)
	}
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("missing recorded account must remain Manual without username fallback")
	}
	if err := h.SetSecret(h.Key("homarr_account"), account); err != nil {
		t.Fatal(err)
	}
	fake.user["id"] = 3
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("an ID-mismatched response must not replace the canonical account identity")
	}
	fake.user["id"] = 2
	owner := fake.user["first_name"]
	fake.user["first_name"] = "synthetic-unowned-marker"
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("a reused account ID without matching provenance must remain Manual")
	}
	fake.user["first_name"] = owner
	fake.profileOwner = "synthetic-different-authenticated-owner"
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("token authentication as a different owner must not be accepted as credential ownership")
	}
	fake.profileOwner = ""

	password := fake.user["password"]
	fake.user["password"] = "synthetic-person-changed-password"
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) || errors.Is(err, helpers.ErrStepFailed) {
		t.Fatal("rejected owned credentials must be retryable Manual, not a failed loop")
	}
	if fake.user["password"] != "synthetic-person-changed-password" || h.Secret(h.Key("api_key")) != key || (*recorded)[len(*recorded)-1].Status != stepstatus.StepManual {
		t.Fatal("credential denial changed the password/token or lost its Manual step")
	}
	fake.user["password"] = password
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("restoring the same saved login did not recover Setup: %v", err)
	}
	savedPassword := h.Secret(h.Key("homarr_password"))
	if err := h.SetSecret(h.Key("homarr_password"), ""); err != nil {
		t.Fatal(err)
	}
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) || h.Secret(h.Key("homarr_password")) != "" {
		t.Fatal("a missing saved password must remain Manual without generating a replacement")
	}
	if err := h.SetSecret(h.Key("homarr_password"), savedPassword); err != nil {
		t.Fatal(err)
	}
	fake.user["is_active"] = false
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) || fake.user["is_active"] != false {
		t.Fatal("disabled owner must remain Manual without automatic reactivation")
	}
	fake.user["is_active"] = true
	fake.user["is_mfa_enabled"] = true
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) || fake.user["is_mfa_enabled"] != true {
		t.Fatal("MFA must remain Manual without disabling it")
	}
	fake.user["is_mfa_enabled"] = false
	permissions := fake.user["user_permissions"]
	fake.user["user_permissions"] = []string{"view_document"}
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("changed account permissions must be preserved for Manual review")
	}
	fake.user["user_permissions"] = permissions

	fake.userStatus = http.StatusServiceUnavailable
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
		t.Fatal("infrastructure failure must not be reclassified as Manual")
	}
	fake.userStatus = 0
	fake.profileStatus = http.StatusForbidden
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) || errors.Is(err, helpers.ErrStepFailed) {
		t.Fatal("profile credential denial must remain a targeted Manual step")
	}
	fake.profileStatus = http.StatusServiceUnavailable
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
		t.Fatal("profile infrastructure failure must remain a failed step")
	}
	fake.profileStatus = 0
	fake.malformedUser = true
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
		t.Fatal("malformed account response must remain a failed step")
	}
	fake.malformedUser = false
	fake.malformedProfile = true
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
		t.Fatal("malformed profile response must remain a failed step")
	}
	fake.malformedProfile = false
	fake.statisticsStatus = http.StatusForbidden
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrManual) {
		t.Fatal("verified token access denial must require targeted Manual permission review")
	}
	fake.statisticsStatus = 0
	fake.malformedCounts = true
	if err := (paperlessngx.App{}).Setup(ctx, h); !errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
		t.Fatal("missing useful data fields must remain a failed step, not empty data or Manual")
	}
	fake.malformedCounts = false
	if err := (paperlessngx.App{}).Setup(ctx, h); err != nil {
		t.Fatalf("restored controls Setup: %v", err)
	}
	if err := (paperlessngx.App{}).Check(ctx, h); err != nil {
		t.Fatalf("restored controls Check: %v", err)
	}
	if fake.creates != 1 || fake.tokenRequests != 1 || fake.mutations != 0 || h.Secret(h.Key("api_key")) != key || h.Secret(h.Key("homarr_account")) != account || h.AdminUser() != "admin" || h.AdminPassword() != "adminpass" {
		t.Fatal("rerun/recovery created replacements, rotated tokens or changed recorded ownership")
	}
}

func TestFailedLoginHintNamesTheApp(t *testing.T) {
	srv := httptest.NewServer((&fakePaperless{reject: true}).handler())
	defer srv.Close()
	h, recorded := newH(t, srv)

	if err := (paperlessngx.App{}).Setup(context.Background(), h); err == nil {
		t.Fatal("Setup should fail when the administrator login is rejected")
	}
	var fail *helpers.StepResult
	for i := range *recorded {
		if (*recorded)[i].Status == stepstatus.StepFail {
			fail = &(*recorded)[i]
		}
	}
	if fail == nil || !strings.Contains(fail.Hint, srv.URL) {
		t.Fatalf("failing step hint should name the App page, got %+v", fail)
	}
}
