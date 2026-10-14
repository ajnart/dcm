package main

import (
	"encoding/json"
	"testing"

	"github.com/ajnart/self-host/internal/apps/beszel"
)

func recipeWith(t *testing.T, services string) recipe {
	t.Helper()
	var rec recipe
	if err := json.Unmarshal([]byte(`{"services":`+services+`}`), &rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestSocketProxyIsTheOnlyServiceAllowedTheDockerSocket(t *testing.T) {
	socket := `[{"name":"docker","target":"/var/run/docker.sock","kind":"bind"}]`
	for _, tc := range []struct {
		name, services string
		allowed        bool
	}{
		{"the named socket proxy", `[{"id":"beszel-socket-proxy","mounts":` + socket + `}]`, true},
		{"the Beszel agent", `[{"id":"beszel-agent","mounts":` + socket + `}]`, false},
		{"the Beszel hub", `[{"id":"beszel","mounts":` + socket + `}]`, false},
		{"another App's service", `[{"id":"watchtower","mounts":` + socket + `}]`, false},
		{"a service without a name", `[{"mounts":` + socket + `}]`, false},
		{"a second service after a harmless first", `[{"id":"app","mounts":[]},{"id":"sidecar","mounts":` + socket + `}]`, false},
		{"the proxy next to a service that mounts it too", `[{"id":"beszel-socket-proxy","mounts":` + socket + `},{"id":"app","mounts":` + socket + `}]`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reason := mountReason(recipeWith(t, tc.services))
			if tc.allowed && reason != "" {
				t.Errorf("rejected: %s", reason)
			}
			if !tc.allowed && reason == "" {
				t.Error("the Docker socket mount was accepted")
			}
		})
	}
}

func TestSocketProxyExceptionCoversOnlyTheSocketItself(t *testing.T) {
	for _, target := range []string{"/var/run", "/var/run/other.sock", "/proc", "/sys/fs", "/var/run/docker.sock.d"} {
		rec := recipeWith(t, `[{"id":"beszel-socket-proxy","mounts":[{"name":"x","target":"`+target+`","kind":"bind"}]}]`)
		if mountReason(rec) == "" {
			t.Errorf("the proxy may mount %s", target)
		}
	}
}

func TestOrdinaryMountsStayAllowed(t *testing.T) {
	rec := recipeWith(t, `[{"id":"app","mounts":[{"name":"data","target":"/data","kind":"volume"},{"name":"cfg","target":"/config","kind":"bind"}]}]`)
	if reason := mountReason(rec); reason != "" {
		t.Errorf("rejected: %s", reason)
	}
}

func TestTheExceptionMatchesTheBeszelApp(t *testing.T) {
	if socketProxyException != beszel.SocketProxyService {
		t.Errorf("exception = %q, but the Beszel App names its proxy %q", socketProxyException, beszel.SocketProxyService)
	}
}
