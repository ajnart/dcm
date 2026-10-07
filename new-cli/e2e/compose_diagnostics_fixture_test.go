package e2e

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestComposeDiagnosticsIdentifyOnlyOwnedServiceReadiness(t *testing.T) {
	document := `[{"Service":"photos","State":"running","Health":"healthy","Name":"private-name","Command":"private-command"},{"Service":"photos-db","State":"restarting","Health":"unhealthy","ExitCode":1,"Env":["private-payload"]},{"Service":"private-unowned","State":"private-state","Health":"private-health"}]`
	if containersReadyJSON(document, []string{"photos", "photos-db"}) {
		t.Fatal("fixture inventory should fail readiness")
	}
	failures := redactedFailures(composeReadinessDiagnostics(document, []string{"photos", "photos-db"}), []string{"photos"})
	data, _ := json.Marshal(failures)
	if !strings.Contains(string(data), "service=photos-db state=restarting health=unhealthy exit_code=1") {
		t.Fatal("inventory failure did not identify failing owned service observations")
	}
	if strings.Contains(string(data), "private-") {
		t.Fatal("unowned services or non-allowlisted fields entered evidence")
	}
}

func TestComposeDiagnosticsHandleMissingDuplicateAndUnsafeValues(t *testing.T) {
	for _, tc := range []struct{ name, document, want string }{
		{"missing", `[]`, "service=photos-db state=missing health=none exit_code=unknown"},
		{"failed-completion", `{"Service":"photos-db","State":"exited","ExitCode":7}`, "service=photos-db state=exited health=none exit_code=7"},
		{"duplicate", `[{"Service":"photos-db","State":"running"},{"Service":"photos-db","State":"running"}]`, "duplicate inventory entries"},
		{"unsafe-values", `[{"Service":"photos-db","State":"private-state","Health":"private-health"}]`, "state=unrecognized health=unrecognized exit_code=unknown"},
		{"invalid", `private-invalid-output`, "unavailable or invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, _ := json.Marshal(composeReadinessDiagnostics(tc.document, []string{"photos-db"}))
			if !strings.Contains(string(data), tc.want) || strings.Contains(string(data), "private-") {
				t.Fatal("bounded readiness diagnosis missing or private value retained")
			}
		})
	}
	if len(composeReadinessDiagnostics(`[{"Service":"restic","State":"exited","ExitCode":0}]`, []string{"restic"})) != 0 {
		t.Fatal("successful one-shot service produced a failure")
	}
}
