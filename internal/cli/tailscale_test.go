package cli_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/tailscale"
	"github.com/ajnart/self-host/internal/service"
	"github.com/ajnart/self-host/internal/system"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestTailscaleFileInputAndAdditiveStatusJSON(t *testing.T) {
	deps := privateFileDeps(t)
	runner := deps.Runner.(*systemtest.Runner)
	runner.OnFunc("docker compose --project-directory", func(cmd system.Cmd) system.Result {
		line := systemtest.Line(cmd)
		switch {
		case strings.Contains(line, " ps "):
			return system.Result{Stdout: []byte("{\"Service\":\"one\",\"State\":\"running\"}\n{\"Service\":\"tailscale\",\"State\":\"running\"}\n{\"Service\":\"tailscale-one\",\"State\":\"running\"}\n")}
		case strings.Contains(line, " exec ") && strings.HasSuffix(line, " status --json"):
			return system.Result{Stdout: []byte(`{"BackendState":"Running","CertDomains":["one-1.example.ts.net"],"Self":{"DNSName":"one-1.example.ts.net."}}`)}
		}
		return system.Result{}
	})
	key := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(key, []byte("synthetic-private-tailscale-key"), 0o600); err != nil {
		t.Fatal(err)
	}
	cat := testCatalog(&echoApp{id: "one", done: map[string]bool{}}, tailscale.App{})
	code, output := runWith(t, deps, cat, "install", "one", "tailscale", "--yes", "--json", "--set-file", "tailscale.auth_key="+key)
	if code != 0 || strings.Contains(output, "synthetic-private-tailscale-key") {
		t.Fatalf("install failed or leaked its private input, exit %d", code)
	}
	code, output = runWith(t, deps, cat, "status", "--json")
	var status service.Status
	if err := json.Unmarshal([]byte(output), &status); err != nil || code != 0 {
		t.Fatalf("status JSON: %v, exit %d", err, code)
	}
	if !slices.Equal(status.Access, []string{"home", "tailscale"}) || status.Exposure != "lan" {
		t.Fatalf("access %v exposure %q", status.Access, status.Exposure)
	}
	for _, a := range status.Apps {
		if a.ID == "one" && (a.URL != "https://one-1.example.ts.net" || !slices.Equal(a.Addresses, []string{"https://one-1.example.ts.net", "http://192.168.1.20:9000"})) {
			t.Fatalf("legacy URL %q, addresses %v", a.URL, a.Addresses)
		}
	}
	if strings.Contains(output+strings.Join(runner.Calls(), "\n"), "synthetic-private-tailscale-key") {
		t.Fatal("private input reached ordinary output or arguments")
	}
}
