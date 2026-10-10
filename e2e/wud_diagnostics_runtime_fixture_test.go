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

func TestWUDObserverFailureProducesBoundedPhaseEvidence(t *testing.T) {
	for _, tc := range []struct{ name, script, expected string }{
		{"command", "#!/bin/sh\nprintf '%s\\n' 'synthetic-private-response' >&2\nexit 1\n", "phase=container-selector outcome=command-failed"},
		{"empty", "#!/bin/sh\nexit 0\n", "phase=container-selector outcome=empty"},
		{"projection", "#!/bin/sh\nif [ \"$1\" = compose ]; then printf '%s\\n' '" + strings.Repeat("a", 64) + "'; else printf '%s\\n' 'synthetic-private-response'; fi\n", "phase=snapshot-validation outcome=invalid-json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			binary := filepath.Join(root, "owned-process-fixture")
			if err := os.WriteFile(binary, []byte(tc.script), 0700); err != nil {
				t.Fatal(err)
			}
			f := &wudRuntimeFixture{realDocker: binary, files: &wudFixtureFiles{observed: root}}
			r := &runner{root: root, project: root, name: "owned-test", commandCtx: context.Background()}
			if f.observe(r) {
				t.Fatal("invalid observation was accepted")
			}
			result := f.observationFailure()
			data, _ := json.Marshal(redactedFailures(result.events, []string{"wud"}))
			if result.code != 1 || !strings.Contains(string(data), tc.expected) || strings.Contains(string(data), "synthetic-private-response") {
				t.Fatal("public evidence lost diagnostic state or retained private output")
			}
		})
	}
}
