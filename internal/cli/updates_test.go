package cli_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/clitest"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

type fakeRegistry struct {
	digest     string
	needsToken bool
	broken     bool
}

func (f *fakeRegistry) server(t *testing.T) *httptest.Server {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case f.broken:
			w.WriteHeader(http.StatusInternalServerError)
		case r.URL.Path == "/token":
			if r.URL.Query().Get("scope") != "repository:test/echo:pull" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"token": "anon-token"})
		case r.URL.Path == "/v2/test/echo/manifests/latest":
			if f.needsToken && r.Header.Get("Authorization") != "Bearer anon-token" {
				w.Header().Set("WWW-Authenticate", `Bearer realm="`+server.URL+`/token",service="test-registry",scope="repository:test/echo:pull"`)
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if !strings.Contains(r.Header.Get("Accept"), "application/vnd.oci.image.index.v1+json") {
				w.WriteHeader(http.StatusNotAcceptable)
				return
			}
			w.Header().Set("Docker-Content-Digest", f.digest)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func updateStatus(t *testing.T, reg *fakeRegistry, localDigest string) string {
	t.Helper()
	server := reg.server(t)
	image := strings.TrimPrefix(server.URL, "http://") + "/test/echo:latest"
	deps := systemtest.NewDeps(t)
	cat := testCatalog(&echoApp{id: "one", image: image, done: map[string]bool{}})
	runWith(t, deps, cat, "install", "one", "--yes")
	deps.Runner.(*systemtest.Runner).On("docker image inspect", system.Result{Stdout: []byte(`["` + strings.TrimSuffix(image, ":latest") + "@" + localDigest + `"]`)})

	r := clitest.Run(t, deps, cat, "status", "--updates", "--json")
	var status struct{ Apps []struct{ ID, Update string } }
	if err := json.Unmarshal([]byte(r.Out), &status); err != nil || len(status.Apps) != 1 {
		t.Fatalf("status: %v\n%s", err, r.Out)
	}
	return status.Apps[0].Update
}

func TestStatusReportsAnAvailableUpdate(t *testing.T) {
	if got := updateStatus(t, &fakeRegistry{digest: "sha256:new"}, "sha256:old"); got != "available" {
		t.Fatalf("update = %q", got)
	}
}

func TestStatusReportsCurrentImages(t *testing.T) {
	if got := updateStatus(t, &fakeRegistry{digest: "sha256:same"}, "sha256:same"); got != "current" {
		t.Fatalf("update = %q", got)
	}
}

func TestRegistryTokenChallengeIsAnswered(t *testing.T) {
	if got := updateStatus(t, &fakeRegistry{digest: "sha256:new", needsToken: true}, "sha256:old"); got != "available" {
		t.Fatalf("update = %q", got)
	}
}

func TestRegistryFailureIsUnknownNotCurrent(t *testing.T) {
	if got := updateStatus(t, &fakeRegistry{digest: "sha256:same", broken: true}, "sha256:same"); got != "unknown" {
		t.Fatalf("update = %q", got)
	}
}
