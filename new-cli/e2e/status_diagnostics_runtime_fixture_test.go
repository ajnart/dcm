//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStatusWaitReturnsLastPublicDocumentDiagnosis(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "public-status-fixture")
	script := "#!/bin/sh\nprintf '%s\\n' '{\"apps\":[{\"id\":\"ntfy\",\"state\":\"restarting\",\"health\":\"unhealthy\",\"setup\":\"ok\"}]}'\nprintf '%s\\n' 'synthetic-private-stderr' >&2\n"
	if os.WriteFile(binary, []byte(script), 0700) != nil {
		t.Fatal("create public CLI fixture")
	}
	old := e2eBinary
	e2eBinary = binary
	t.Cleanup(func() { e2eBinary = old })
	r := &runner{root: root, commandCtx: context.Background()}
	ready, emitted := r.waitRunningWithDiagnostics(0, []string{"ntfy"})
	data, _ := json.Marshal(redactedFailures(emitted, []string{"ntfy"}))
	if ready || !strings.Contains(string(data), "state=restarting") || strings.Contains(string(data), "synthetic-private") {
		t.Fatal("status wait discarded its structured diagnosis or retained raw stderr")
	}
}

func TestStatusWaitReturnsFailingOwnedComposeServiceDiagnosis(t *testing.T) {
	root := t.TempDir()
	binary := filepath.Join(root, "public-status-fixture")
	status := "#!/bin/sh\nprintf '%s\\n' '{\"apps\":[{\"id\":\"ntfy\",\"state\":\"running\",\"setup\":\"ok\"}]}'\n"
	if os.WriteFile(binary, []byte(status), 0700) != nil {
		t.Fatal("create public CLI fixture")
	}
	docker := "#!/bin/sh\nprintf '%s\\n' '{\"Service\":\"ntfy\",\"State\":\"restarting\",\"Health\":\"unhealthy\",\"ExitCode\":2,\"Name\":\"synthetic-private-name\"}'\n"
	if os.WriteFile(filepath.Join(root, "docker"), []byte(docker), 0700) != nil {
		t.Fatal("create owned process boundary fixture")
	}
	// Resolve only the temporary fake Docker executable; no real Docker runs.
	t.Setenv("PATH", root)
	old := e2eBinary
	e2eBinary = binary
	t.Cleanup(func() { e2eBinary = old })
	r := &runner{root: root, project: root, name: "owned-fixture", spec: targetSpec{Apps: []string{"ntfy"}}, commandCtx: context.Background()}
	ready, emitted := r.waitRunningWithDiagnostics(0, []string{"ntfy"})
	data, _ := json.Marshal(redactedFailures(emitted, []string{"ntfy"}))
	if ready || !strings.Contains(string(data), "service=ntfy state=restarting health=unhealthy exit_code=2") || strings.Contains(string(data), "synthetic-private") {
		t.Fatal("status wait discarded owned Compose diagnosis or retained a private field")
	}
}
