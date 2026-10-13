package homarr

import (
	"context"
	"testing"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestFrigateStatsThroughSharedHTTPVerification(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		valid  bool
	}{
		{"valid zero", func(*statsFixture) {}, true},
		{"valid populated sample", func(f *statsFixture) { f.values["cameras"] = float64(2) }, true},
		{"negative count", func(f *statsFixture) { f.values["cameras"] = float64(-1) }, false},
		{"fractional count", func(f *statsFixture) { f.values["cameras"] = float64(0.5) }, false},
		{"text count", func(f *statsFixture) { f.values["cameras"] = "0" }, false},
		{"wrong count unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"missing selected value", func(f *statsFixture) { delete(f.values, "uptime") }, false},
		{"null selected value", func(f *statsFixture) { f.values["version"] = nil }, false},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, false},
		{"wrong uptime unit", func(f *statsFixture) { f.metrics[1].(map[string]any)["unit"] = "milliseconds" }, false},
		{"negative uptime", func(f *statsFixture) { f.values["uptime"] = float64(-1) }, false},
		{"fractional uptime is valid", func(f *statsFixture) { f.values["uptime"] = float64(0.5) }, true},
		{"wrong version unit", func(f *statsFixture) { f.metrics[2].(map[string]any)["unit"] = "count" }, false},
		{"missing version", func(f *statsFixture) { f.values["version"] = "" }, false},
		{"unsupported version", func(f *statsFixture) { f.values["version"] = "0.17.0" }, false},
		{"supported version suffix", func(f *statsFixture) { f.values["version"] = "0.18.0-fixture" }, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"cameras": float64(0), "uptime": float64(0), "version": "0.18.0"}
			fixture.metrics = []any{
				map[string]any{"key": "cameras", "unit": "count"},
				map[string]any{"key": "uptime", "unit": "seconds"},
				map[string]any{"key": "version", "unit": "text"},
			}
			scenario.change(fixture)
			h := fixture.helpers(t)
			descriptor := frigateTarget()
			nativeChecks := 0
			// Isolate Stats acquisition; App readiness and native API checks retain
			// their own fixtures and are not runtime acceptance in this scenario.
			descriptor.verify = func(context.Context, *helpers.H, *helpers.H, string) error {
				nativeChecks++
				return nil
			}
			err := descriptor.verifyData(t.Context(), h, h, "frigate-owned")
			if (err == nil) != scenario.valid {
				t.Fatalf("valid=%v, verification error=%v", scenario.valid, err)
			}
			if nativeChecks != 1 || fixture.catalogs != 1 || fixture.refreshes != 1 || !fixture.force || fixture.integrationID != "frigate-owned" {
				t.Fatalf("want one native check, catalog and forced refresh for the owned integration: native=%d catalogs=%d refreshes=%d force=%v id=%q", nativeChecks, fixture.catalogs, fixture.refreshes, fixture.force, fixture.integrationID)
			}
		})
	}
}
