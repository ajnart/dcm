package homarr

import (
	"context"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestBazarrStatsThroughSharedHTTPVerification(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		valid  bool
	}{
		{"valid zero", func(*statsFixture) {}, true},
		{"valid populated sample", func(f *statsFixture) { f.values["episodes"] = float64(2) }, true},
		{"negative count", func(f *statsFixture) { f.values["episodes"] = float64(-1) }, false},
		{"fractional count", func(f *statsFixture) { f.values["episodes"] = float64(0.5) }, false},
		{"text count", func(f *statsFixture) { f.values["episodes"] = "0" }, false},
		{"wrong count unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"missing selected value", func(f *statsFixture) { delete(f.values, "movies") }, false},
		{"null selected value", func(f *statsFixture) { f.values["providers"] = nil }, false},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, false},
		{"invalid movies count", func(f *statsFixture) { f.values["movies"] = float64(0.5) }, false},
		{"invalid providers count", func(f *statsFixture) { f.values["providers"] = float64(0.5) }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"episodes": float64(0), "movies": float64(0), "providers": float64(0)}
			fixture.metrics = []any{
				map[string]any{"key": "episodes", "unit": "count"},
				map[string]any{"key": "movies", "unit": "count"},
				map[string]any{"key": "providers", "unit": "count"},
			}
			scenario.change(fixture)
			h := fixture.helpers(t)
			descriptor := bazarrTarget()
			nativeChecks := 0
			// Isolate Stats acquisition; App readiness and native API checks retain
			// their own fixtures and are not runtime acceptance in this scenario.
			descriptor.verify = func(context.Context, *helpers.H, *helpers.H, string) error {
				nativeChecks++
				return nil
			}
			err := descriptor.verifyData(t.Context(), h, h, "bazarr-owned")
			if (err == nil) != scenario.valid {
				t.Fatalf("valid=%v, verification error=%v", scenario.valid, err)
			}
			if nativeChecks != 1 || fixture.catalogs != 1 || fixture.refreshes != 1 || !fixture.force || fixture.integrationID != "bazarr-owned" {
				t.Fatalf("want one native check, catalog and forced refresh for the owned integration: native=%d catalogs=%d refreshes=%d force=%v id=%q", nativeChecks, fixture.catalogs, fixture.refreshes, fixture.force, fixture.integrationID)
			}
		})
	}
}
