package cli_test

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type passwordPolicyApp struct{ echoApp }

func (passwordPolicyApp) Secrets() []app.SecretSpec {
	return []app.SecretSpec{{Name: "api_token", Length: 32}, {Name: "hex_key", Length: 32, Hex: true}}
}
func (a passwordPolicyApp) Setup(ctx context.Context, h *helpers.H) error {
	// Pinned PatchMon2.1.3 and Pangolin1.24.0 both require all four classes.
	password := h.AdminPassword()
	if len(password) < 8 || len(password) > 128 {
		return errors.New("administrator password length rejected")
	}
	for _, pattern := range []string{`[A-Z]`, `[a-z]`, `[0-9]`, `[!@%*+_-]`} {
		if !regexp.MustCompile(pattern).MatchString(password) {
			return errors.New("administrator password class rejected")
		}
	}
	return a.echoApp.Setup(ctx, h)
}

func readAdminCredential(t *testing.T, deps *system.Deps, apps ...app.App) string {
	t.Helper()
	code, out := runWith(t, deps, testCatalog(apps...), "credentials", "--json")
	var credentials struct{ Admin struct{ Password string } }
	if code != 0 || json.Unmarshal([]byte(out), &credentials) != nil || credentials.Admin.Password == "" {
		t.Fatal("private credential handoff failed")
	}
	return credentials.Admin.Password
}

func TestNewProjectAdminSatisfiesPinnedPasswordPolicies(t *testing.T) {
	deps := systemtest.NewDeps(t)
	fixture := &passwordPolicyApp{echoApp{id: "one", done: map[string]bool{}}}
	code, out := runWith(t, deps, testCatalog(fixture), "install", "one", "--yes", "--json")
	if code != 0 {
		t.Fatal("first install rejected generated administrator password")
	}
	password := readAdminCredential(t, deps, fixture)
	if len(password) != 20 || !regexp.MustCompile(`^[A-Za-z0-9!]{20}$`).MatchString(password) {
		t.Fatal("generated administrator credential length or safe alphabet changed")
	}
	if strings.Contains(out, password) {
		t.Fatal("install disclosed generated administrator credential")
	}
	code, out = runWith(t, deps, testCatalog(fixture), "credentials", "--json")
	var credentials struct{ Apps map[string]map[string]string }
	if code != 0 || json.Unmarshal([]byte(out), &credentials) != nil {
		t.Fatal("private application credential handoff failed")
	}
	if !regexp.MustCompile(`^[A-Za-z0-9]{32}$`).MatchString(credentials.Apps["one"]["ONE_API_TOKEN"]) || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(credentials.Apps["one"]["ONE_HEX_KEY"]) {
		t.Fatal("application token generators changed with administrator policy")
	}
}

func TestExistingAndCustomAdminCredentialsRemainUnchanged(t *testing.T) {
	for _, custom := range []bool{false, true} {
		name := "generated"
		if custom {
			name = "custom"
		}
		t.Run(name, func(t *testing.T) {
			deps := systemtest.NewDeps(t)
			base := deps.Getenv
			if custom {
				deps.Getenv = func(key string) string {
					if key == "SELF_HOST_ADMIN_PASSWORD" {
						return "OwnerChosenLegacyPassword"
					}
					return base(key)
				}
			}
			one := &echoApp{id: "one", done: map[string]bool{}}
			two := &echoApp{id: "two", done: map[string]bool{}}
			cat := testCatalog(one, two)
			if code, _ := runWith(t, deps, cat, "install", "one", "--yes", "--json"); code != 0 {
				t.Fatal("first install failed")
			}
			deps.Getenv = base
			saved := readAdminCredential(t, deps, one, two)
			if custom && saved != "OwnerChosenLegacyPassword" {
				t.Fatal("custom administrator credential was replaced")
			}
			for _, id := range []string{"one", "two"} {
				if code, _ := runWith(t, deps, cat, "install", id, "--yes", "--json"); code != 0 {
					t.Fatal("existing project install failed")
				}
				if readAdminCredential(t, deps, one, two) != saved {
					t.Fatal("existing administrator credential rotated")
				}
			}
		})
	}
}
