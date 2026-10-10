package cli_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestEasyNamesStatusJSONKeepsTheFallbackAndLegacyFields(t *testing.T) {
	deps, cat := installed(t, "one")
	if code, out := runWith(t, deps, cat, "config", "set", "EASY_NAMES=on"); code != 0 {
		t.Fatalf("enable %d: %s", code, out)
	}
	code, out := runWith(t, deps, cat, "status", "--json")
	var status service.Status
	if code != 0 || json.Unmarshal([]byte(out), &status) != nil {
		t.Fatalf("status %d: %s", code, out)
	}
	a := status.Apps[0]
	if status.Exposure != "lan" || len(status.Access) != 2 || a.URL != "http://one.192-168-1-20.sslip.io" || len(a.Addresses) != 2 || a.Addresses[1] != "http://192.168.1.20:9000" {
		t.Fatalf("status %s", out)
	}
	_, out = runWith(t, deps, cat, "status")
	for _, want := range []string{"checked from this computer", "http://one.192-168-1-20.sslip.io", "http://192.168.1.20:9000"} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q: %s", want, out)
		}
	}
	deps.Resolver = &systemtest.Resolver{Blocked: true}
	_, out = runWith(t, deps, cat, "status")
	if !strings.Contains(out, "Your router hides the easy names") || strings.Contains(out, "http://one.") {
		t.Fatal(out)
	}
}
