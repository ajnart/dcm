package homarr

import (
	"context"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestArchiveTeamWarriorStatsThroughSharedHTTPVerification(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		valid  bool
	}{
		{"valid zero", func(*statsFixture) {}, true},
		{"valid populated sample", func(f *statsFixture) { f.values["running"] = float64(2) }, true},
		{"negative count", func(f *statsFixture) { f.values["running"] = float64(-1) }, false},
		{"fractional count", func(f *statsFixture) { f.values["running"] = float64(0.5) }, false},
		{"text count", func(f *statsFixture) { f.values["running"] = "0" }, false},
		{"wrong count unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"missing selected value", func(f *statsFixture) { delete(f.values, "completed") }, false},
		{"null selected value", func(f *statsFixture) { f.values["failed"] = nil }, false},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, false},
		{"invalid completed count", func(f *statsFixture) { f.values["completed"] = float64(0.5) }, false},
		{"invalid failed count", func(f *statsFixture) { f.values["failed"] = float64(0.5) }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"running": float64(0), "completed": float64(0), "failed": float64(0)}
			fixture.metrics = []any{
				map[string]any{"key": "running", "unit": "count"},
				map[string]any{"key": "completed", "unit": "count"},
				map[string]any{"key": "failed", "unit": "count"},
			}
			scenario.change(fixture)
			h := fixture.helpers(t)
			descriptor := archiveTeamWarriorTarget()
			nativeChecks := 0
			// Isolate Stats acquisition; App readiness and native API checks retain
			// their own fixtures and are not runtime acceptance in this scenario.
			descriptor.verify = func(context.Context, *helpers.H, *helpers.H, string) error {
				nativeChecks++
				return nil
			}
			err := descriptor.verifyData(t.Context(), h, h, "archive_team_warrior-owned")
			if (err == nil) != scenario.valid {
				t.Fatalf("valid=%v, verification error=%v", scenario.valid, err)
			}
			if nativeChecks != 1 || fixture.catalogs != 1 || fixture.refreshes != 1 || !fixture.force || fixture.integrationID != "archive_team_warrior-owned" {
				t.Fatalf("want one native check, catalog and forced refresh for the owned integration: native=%d catalogs=%d refreshes=%d force=%v id=%q", nativeChecks, fixture.catalogs, fixture.refreshes, fixture.force, fixture.integrationID)
			}
		})
	}
}
