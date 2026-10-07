package patchmon_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/patchmon"
	"github.com/ajnart/self-host/internal/catalog"
	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestInstallAndRerunReusePinnedClientSession(t *testing.T) {
	fake := &fakePatchmon{}
	backend := fake.handler()
	var setupDevice string
	sessions := 0
	logins := 0
	// Freeze token issuance to one second. Pinned refresh JWTs have no nonce;
	// identical user/role/iat/exp claims collide with refresh_token UNIQUE unless
	// X-Device-ID lets the server reuse the setup-admin session.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/setup-admin" {
			setupDevice = r.Header.Get("X-Device-ID")
			sessions++
			backend.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/login" && fake.hasAdmin {
			body, err := io.ReadAll(r.Body)
			if err != nil {
				w.WriteHeader(400)
				return
			}
			var login struct{ Username, Password string }
			json.Unmarshal(body, &login)
			r.Body = io.NopCloser(bytes.NewReader(body))
			// Pinned Login authenticates the user before session lookup/reuse.
			if login.Username != "admin" || login.Password != fake.password {
				backend.ServeHTTP(w, r)
				return
			}
			if device := r.Header.Get("X-Device-ID"); device == "" || device != setupDevice {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			logins++
		}
		backend.ServeHTTP(w, r)
	}))
	defer server.Close()
	deps := systemtest.NewDeps(t)
	cat := catalog.New([]app.App{patchmon.App{}}, nil)
	args := []string{"install", "patchmon", "--yes", "--json", "--set", "patchmon.port=" + clitest.Port(server)}
	for attempt := 0; attempt < 2; attempt++ {
		result := clitest.Run(t, deps, cat, args...)
		if strings.Contains(result.Out, fake.password) || strings.Contains(result.Out, setupDevice) && setupDevice != "" {
			t.Fatal("ordinary install output disclosed credential or device header")
		}
		if result.Code != 0 {
			t.Fatalf("install %s failed to reuse the pinned auth session", strconv.Itoa(attempt+1))
		}
	}
	if setupDevice == "" || sessions != 1 || logins < 2 {
		t.Fatal("rerun did not reuse one initial client session")
	}
}

func TestExistingIncompatibleOwnerIsNotReplacedOrGivenSession(t *testing.T) {
	fake := &fakePatchmon{hasAdmin: true, password: "OwnerPrivateFixture123!"}
	handler := fake.handler()
	creates, authenticated := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/setup-admin" {
			creates++
		}
		if r.URL.Path == "/api/v1/auth/login" {
			body, _ := io.ReadAll(r.Body)
			var login struct{ Password string }
			json.Unmarshal(body, &login)
			r.Body = io.NopCloser(bytes.NewReader(body))
			if login.Password == fake.password {
				authenticated++
			}
		}
		handler.ServeHTTP(w, r)
	}))
	defer server.Close()
	deps := systemtest.NewDeps(t)
	cat := catalog.New([]app.App{patchmon.App{}}, nil)
	for attempt := 0; attempt < 2; attempt++ {
		result := clitest.Run(t, deps, cat, "install", "patchmon", "--yes", "--json", "--set", "patchmon.port="+clitest.Port(server))
		if result.Code == 0 {
			t.Fatal("incompatible existing owner was accepted")
		}
		if strings.Contains(result.Out, fake.password) || strings.Contains(result.Out, "self-host-patchmon") {
			t.Fatal("owner credential or device header was logged")
		}
	}
	if creates != 0 || authenticated != 0 || fake.password != "OwnerPrivateFixture123!" {
		t.Fatal("existing owner or its authenticated session was replaced")
	}
}
