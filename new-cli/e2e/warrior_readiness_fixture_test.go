package e2e

import (
	"slices"
	"testing"
)

func TestWarriorRequiresSuccessfulInitAndRunningMain(t *testing.T) {
	expected := expectedServices(targetSpec{Apps: []string{"archive-team-warrior"}})
	if len(expected) != 2 || !slices.Contains(expected, "archive-team-warrior-init") || !slices.Contains(expected, "archive-team-warrior") {
		t.Fatal("owned init omitted from expected service evidence")
	}
	for _, tc := range []struct {
		name, rows string
		want       bool
	}{
		{"successful init and runtime", `[{"Service":"archive-team-warrior-init","State":"exited","ExitCode":0},{"Service":"archive-team-warrior","State":"running"}]`, true},
		{"failed init", `[{"Service":"archive-team-warrior-init","State":"exited","ExitCode":1},{"Service":"archive-team-warrior","State":"running"}]`, false},
		{"unfinished init", `[{"Service":"archive-team-warrior-init","State":"running"},{"Service":"archive-team-warrior","State":"running"}]`, false},
		{"missing init", `[{"Service":"archive-team-warrior","State":"running"}]`, false},
		{"missing exit code", `[{"Service":"archive-team-warrior-init","State":"exited"},{"Service":"archive-team-warrior","State":"running"}]`, false},
		{"exited runtime", `[{"Service":"archive-team-warrior-init","State":"exited","ExitCode":0},{"Service":"archive-team-warrior","State":"exited","ExitCode":0}]`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if containersReadyJSON(tc.rows, expected) != tc.want {
				t.Fatal("Warrior readiness misclassified")
			}
		})
	}
}
