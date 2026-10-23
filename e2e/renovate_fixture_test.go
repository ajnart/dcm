package e2e

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/catalog"
)

type renovateRoundTrip func(*http.Request) (*http.Response, error)

func (fn renovateRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }

func renovateResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}
}

func TestRenovateCredentialHandoffUsesPublicForgejoAlias(t *testing.T) {
	admin, password, token, ok := decodeRenovateCredentialHandoff([]byte(`{
		"admin":{"username":"admin","password":"synthetic-password","aliases":{"forgejo":"selfhost-admin"}},
		"apps":{"renovate":{"RENOVATE_TOKEN":"synthetic-renovate-token"}}
	}`))
	if !ok || admin != "selfhost-admin" || password != "synthetic-password" || token != "synthetic-renovate-token" {
		t.Fatalf("public credential handoff = admin %q password-present %t token-present %t ok %t", admin, password != "", token != "", ok)
	}
}

func TestRenovateCredentialHandoffFallsBackToSharedAdmin(t *testing.T) {
	admin, password, _, ok := decodeRenovateCredentialHandoff([]byte(`{"admin":{"username":"owner","password":"synthetic-password"},"apps":{}}`))
	if !ok || admin != "owner" || password != "synthetic-password" {
		t.Fatal("shared administrator fallback was not retained")
	}
}

func TestRenovateOwnedForgeIsIncludedBeforeAdmission(t *testing.T) {
	c := catalog.Default()
	original := findTarget(acceptanceInventory(c), "renovate")
	target := withOwnedPrerequisites(original)
	if !reflect.DeepEqual(target.Apps, []string{"renovate", "forgejo"}) || len(original.Apps) != 1 {
		t.Fatal("owned Forgejo missing from complete Renovate target")
	}
	if !reflect.DeepEqual(withOwnedPrerequisites(target).Apps, target.Apps) {
		t.Fatal("owned Forgejo duplicated")
	}
	if classifyTarget(c, target) != "runnable" || classifyTarget(c, original) != "awaiting-external-credentials" {
		t.Fatal("only the target with an actual owned forge prerequisite should be runnable")
	}
	guard := newSweepGuard(1)
	lease, err := guard.acquire(context.Background(), len(target.Apps), exclusiveTarget(c, target))
	if err != nil {
		t.Fatal("complete owned fixture was not admitted")
	}
	defer lease.finish(true)
	if jobs, apps := guard.capacity(); jobs != 1 || apps != 2 {
		t.Fatal("owned Forgejo excluded from capacity accounting")
	}
	if services := expectedServices(target); !reflect.DeepEqual(services, []string{"renovate", "forgejo"}) {
		t.Fatal("owned Forgejo excluded from readiness/image inventory")
	}
	if got := safeCommand([]string{"install", "renovate", "--set-file", "renovate.token=/tmp/owned-private-pat"}); got[3] != "renovate.token=<owned-credential>" {
		t.Fatal("owned credential path leaked into evidence")
	}
	for _, stage := range newEvidence(target, "fixture").Stages {
		if len(stage.Apps) != 2 {
			t.Fatal("owned Forgejo excluded from lifecycle accounting")
		}
	}
}

func TestRenovateFixtureRejectsChangedOwnerOrPersistedToken(t *testing.T) {
	const token = "synthetic-api-issued-token"
	f := &renovateForgejoFixture{username: "fixture-bot", password: "synthetic-bot-password", tokenName: "selfhost-e2e-renovate", userID: 17, tokenID: 29, tokenHash: sha256.Sum256([]byte(token))}
	for _, tc := range []struct{ name, user, tokens, want string }{
		{"wrong-account", `{"id":18,"login":"other","email":"other@e2e.selfhost.test","is_admin":false,"active":true}`, `[]`, "owned Forgejo PAT did not authenticate the dedicated bot"},
		{"administrator", `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":true,"active":true}`, `[]`, "owned Forgejo PAT did not authenticate the dedicated bot"},
		{"missing-token-id", `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":false,"active":true}`, `[{"id":30,"name":"selfhost-e2e-renovate","scopes":["read:user","write:repository"]}]`, "owned Forgejo token ID was not retained"},
		{"widened-scope", `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":false,"active":true}`, `[{"id":29,"name":"selfhost-e2e-renovate","scopes":["all"]}]`, "owned Forgejo token ID was not retained"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inventoryRequests := 0
			client := &http.Client{Transport: renovateRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/api/v1/user" {
					return renovateResponse(200, tc.user), nil
				}
				inventoryRequests++
				return renovateResponse(200, tc.tokens), nil
			})}
			if err := f.verify(context.Background(), client, "http://127.0.0.1:3000", token); err == nil || err.Error() != tc.want {
				t.Fatalf("changed owned identity/token refusal = %v, want %q", err, tc.want)
			}
			if tc.want == "owned Forgejo token ID was not retained" {
				if inventoryRequests != 1 {
					t.Fatalf("inventory requests = %d, want 1", inventoryRequests)
				}
			}
		})
	}
	client := &http.Client{Transport: renovateRoundTrip(func(*http.Request) (*http.Response, error) {
		t.Fatal("changed saved token should be refused before transport")
		return nil, nil
	})}
	if err := f.verify(context.Background(), client, "http://127.0.0.1:3000", "changed-token"); err == nil {
		t.Fatal("changed saved token accepted")
	}
}

func TestRenovateFixtureRefusesUnownedOriginAndSuppressesResponseSecrets(t *testing.T) {
	client := &http.Client{Transport: renovateRoundTrip(func(*http.Request) (*http.Response, error) {
		return renovateResponse(403, `{"message":"synthetic-private-password-and-token"}`), nil
	})}
	for _, origin := range []string{"http://127.0.0.1:3000", "https://example.com", "http://private@127.0.0.1:3000"} {
		_, token, err := issueRenovateToken(context.Background(), client, origin, "admin", "synthetic-private-password-and-token", "fixture-bot", "synthetic-private-password-and-token")
		if err == nil || token != "" || strings.Contains(err.Error(), "synthetic-private") {
			t.Fatal("unowned/refused API operation or response secret accepted")
		}
	}
}

func TestRenovateFixtureClassifiesTokenCreationFailureWithoutResponsePayload(t *testing.T) {
	client := &http.Client{Transport: renovateRoundTrip(func(r *http.Request) (*http.Response, error) {
		switch r.Method + " " + r.URL.Path {
		case "POST /api/v1/admin/users":
			return renovateResponse(201, `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":false,"active":true}`), nil
		}
		return renovateResponse(403, `{"message":"synthetic-private-password-and-token"}`), nil
	})}
	_, token, err := issueRenovateToken(context.Background(), client, "http://127.0.0.1:3000", "selfhost-admin", "synthetic-admin-password", "fixture-bot", "synthetic-bot-password")
	if err == nil || token != "" || err.Error() != "owned Forgejo token creation failed" {
		t.Fatalf("token creation failure was not safely classified: %v", err)
	}
}

func TestRenovateFixtureBotCreationReportsOnlyStatusOrInvalidFieldNames(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
		status           int
	}{
		{name: "rejected", status: 422, body: `{"message":"synthetic-private-password-and-token"}`, want: "owned Forgejo bot creation returned HTTP 422"},
		{name: "inactive", status: 201, body: `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":false}`, want: "owned Forgejo bot identity response had invalid fields: active"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: renovateRoundTrip(func(*http.Request) (*http.Response, error) {
				return renovateResponse(tc.status, tc.body), nil
			})}
			_, token, err := issueRenovateToken(context.Background(), client, "http://127.0.0.1:3000", "selfhost-admin", "synthetic-admin-password", "fixture-bot", "synthetic-bot-password")
			if err == nil || token != "" || err.Error() != tc.want || strings.Contains(err.Error(), "synthetic-private") {
				t.Fatalf("bot creation observation = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestRenovateFixtureRequiresExplicitRegularBotRole(t *testing.T) {
	for _, tc := range []struct {
		name, role string
	}{
		{name: "missing"},
		{name: "null", role: `,"is_admin":null`},
		{name: "administrator", role: `,"is_admin":true`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: renovateRoundTrip(func(*http.Request) (*http.Response, error) {
				return renovateResponse(201, `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","active":true`+tc.role+`}`), nil
			})}
			_, token, err := issueRenovateToken(context.Background(), client, "http://127.0.0.1:3000", "selfhost-admin", "synthetic-admin-password", "fixture-bot", "synthetic-bot-password")
			if err == nil || token != "" || err.Error() != "owned Forgejo bot identity response had invalid fields: is_admin" {
				t.Fatalf("bot role observation = %v", err)
			}
		})
	}
}

func TestRenovateFixturePATIdentityRequiresExplicitRegularBotRole(t *testing.T) {
	const token = "synthetic-api-issued-token"
	f := &renovateForgejoFixture{username: "fixture-bot", password: "synthetic-bot-password", tokenName: "selfhost-e2e-renovate", userID: 17, tokenID: 29, tokenHash: sha256.Sum256([]byte(token))}
	for _, tc := range []struct {
		name, role string
	}{
		{name: "missing"},
		{name: "null", role: `,"is_admin":null`},
		{name: "administrator", role: `,"is_admin":true`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: renovateRoundTrip(func(*http.Request) (*http.Response, error) {
				return renovateResponse(200, `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","active":true`+tc.role+`}`), nil
			})}
			if err := f.verify(context.Background(), client, "http://127.0.0.1:3000", token); err == nil || err.Error() != "owned Forgejo PAT did not authenticate the dedicated bot" {
				t.Fatalf("PAT role observation = %v", err)
			}
		})
	}
}
func TestRenovateFixtureIssuesRealScopedTokenAndProvesIdentity(t *testing.T) {
	var requests []string
	client := &http.Client{Transport: renovateRoundTrip(func(r *http.Request) (*http.Response, error) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /api/v1/admin/users":
			user, pass, ok := r.BasicAuth()
			var body struct {
				Username   string `json:"username"`
				Password   string `json:"password"`
				MustChange bool   `json:"must_change_password"`
				Notify     bool   `json:"send_notify"`
			}
			if !ok || user != "selfhost-admin" || pass != "synthetic-admin-password" || json.NewDecoder(r.Body).Decode(&body) != nil || body.Username != "fixture-bot" || body.Password != "synthetic-bot-password" || body.MustChange || body.Notify {
				t.Fatal("owned account creation authentication or body incorrect")
			}
			return renovateResponse(201, `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":false,"active":true}`), nil
		case "POST /api/v1/users/fixture-bot/tokens":
			user, pass, ok := r.BasicAuth()
			var body struct {
				Name   string   `json:"name"`
				Scopes []string `json:"scopes"`
			}
			if !ok || user != "fixture-bot" || pass != "synthetic-bot-password" || json.NewDecoder(r.Body).Decode(&body) != nil || body.Name != "selfhost-e2e-renovate" || !reflect.DeepEqual(body.Scopes, []string{"read:user", "write:repository"}) {
				t.Fatal("owned token issuance authentication or scopes incorrect")
			}
			return renovateResponse(201, `{"id":29,"name":"selfhost-e2e-renovate","sha1":"synthetic-api-issued-token","scopes":["read:user","write:repository"]}`), nil
		case "GET /api/v1/user":
			if r.Header.Get("Authorization") != "token synthetic-api-issued-token" {
				t.Fatal("identity probe did not use the issued PAT")
			}
			return renovateResponse(200, `{"id":17,"login":"fixture-bot","email":"fixture-bot@e2e.selfhost.test","is_admin":false,"active":true}`), nil
		case "GET /api/v1/users/fixture-bot/tokens":
			user, pass, ok := r.BasicAuth()
			if !ok || user != "fixture-bot" || pass != "synthetic-bot-password" {
				t.Fatal("persisted token ID probe did not use the dedicated account")
			}
			return renovateResponse(200, `[{"id":29,"name":"selfhost-e2e-renovate","scopes":["read:user","write:repository"]}]`), nil
		default:
			t.Fatal("fixture attempted an unexpected API mutation")
			return nil, nil
		}
	})}
	f, token, err := issueRenovateToken(context.Background(), client, "http://127.0.0.1:3000", "selfhost-admin", "synthetic-admin-password", "fixture-bot", "synthetic-bot-password")
	if err != nil || f == nil || token != "synthetic-api-issued-token" {
		t.Fatal("real owned token response was not consumed")
	}
	if err := f.verify(context.Background(), client, "http://127.0.0.1:3000", token); err != nil {
		t.Fatal("issued token identity or persisted ID was not proven")
	}
	if len(requests) != 6 {
		t.Fatalf("requests = %d, want two mutations and two identity+ID checks", len(requests))
	}
}
