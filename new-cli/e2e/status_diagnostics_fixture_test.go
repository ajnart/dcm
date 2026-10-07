package e2e

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
)

func TestStatusDiagnosticsRetainOwnedRedactedCheckFailure(t *testing.T) {
	document := `{"project":"private-project","settings":{"PRIVATE":"synthetic-secret"},"apps":[{"id":"ntfy","url":"http://private-host","setup":"incomplete","state":"running","steps":[{"id":"check","status":"fail","error":"owner verification failed with [REDACTED]","hint":"self-host logs ntfy"}]},{"id":"unowned","steps":[{"id":"check","status":"fail","error":"synthetic-secret"}]}]}`
	emitted := statusReadinessDiagnostics(document, []string{"ntfy"}, false)
	failures := redactedFailures(emitted, []string{"ntfy"})
	if len(failures) == 0 || failures[0].App != "ntfy" || failures[0].Step != "check" || failures[0].Error != "owner verification failed with [REDACTED]" || failures[0].Hint != "self-host logs ntfy" {
		t.Fatal("owned redacted Check failure lost from public status document")
	}
	data, _ := json.Marshal(failures)
	for _, private := range []string{"synthetic-secret", "private-project", "private-host", "unowned"} {
		if strings.Contains(string(data), private) {
			t.Fatal("non-reporting status fields entered evidence")
		}
	}
}

func TestStatusDiagnosticsReportOwnedReadinessWithoutPrivateFields(t *testing.T) {
	for _, tc := range []struct{ name, document, want string }{
		{"restarting", `{"apps":[{"id":"ntfy","state":"restarting","health":"unhealthy","setup":"ok"}]}`, "state=restarting health=unhealthy setup=ok"},
		{"missing", `{"apps":[]}`, "App missing"},
		{"invalid", `synthetic-private-stdout`, "unavailable or invalid"},
		{"unrecognized", `{"apps":[{"id":"ntfy","state":"synthetic-private-state","health":"synthetic-private-health","setup":"synthetic-private-setup"}]}`, "state=unrecognized health=unrecognized setup=unrecognized"},
		{"compose-inventory", `{"apps":[{"id":"ntfy","state":"running","setup":"ok"}]}`, "owned Compose service inventory"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			failures := redactedFailures(statusReadinessDiagnostics(tc.document, []string{"ntfy"}, false), []string{"ntfy"})
			data, _ := json.Marshal(failures)
			if len(failures) == 0 || !strings.Contains(string(data), tc.want) || strings.Contains(string(data), "synthetic-private") {
				t.Fatal("owned readiness diagnosis missing or private value retained")
			}
		})
	}
	if got := statusReadinessDiagnostics(`{"apps":[{"id":"ntfy","state":"running","setup":"ok"}]}`, []string{"ntfy"}, true); len(got) != 0 {
		t.Fatal("healthy public status produced a failure")
	}
}

func TestStatusDiagnosticsPreserveProducerSecretRedaction(t *testing.T) {
	log := events.Discard()
	log.Secret("synthetic-private-password")
	// Match Status's producer boundary: legacy step and Docker diagnostics are
	// redacted after the project's secret values have been registered.
	doc := map[string]any{"docker_error": log.Redact("Docker refused synthetic-private-password"), "apps": []any{map[string]any{
		"id": "ntfy", "state": "unknown", "setup": "incomplete",
		"steps": []any{map[string]string{"id": "check", "status": "fail", "error": log.Redact("Check refused synthetic-private-password"), "hint": log.Redact("retry synthetic-private-password")}},
	}}}
	document, _ := json.Marshal(doc)
	data, _ := json.Marshal(redactedFailures(statusReadinessDiagnostics(string(document), []string{"ntfy"}, false), []string{"ntfy"}))
	if strings.Contains(string(data), "synthetic-private-password") || !strings.Contains(string(data), "[redacted]") || !strings.Contains(string(data), "Docker refused") || !strings.Contains(string(data), "Check refused") {
		t.Fatal("producer redaction or useful Check/Docker diagnosis was lost")
	}
}
