package homarr

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestPatchmonPrivacyHoldPrecedesHomarrRequests(t *testing.T) {
	readiness, unexpected := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/api/v1/settings/login-settings" {
			unexpected++
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		readiness++
		json.NewEncoder(w).Encode(map[string]any{"current_version": "2.1.3", "hasAdminUsers": true})
	}))
	defer server.Close()
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard()})
	to := helpers.New(helpers.Config{App: "patchmon", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(),
		Secrets: statsSecrets{"PATCHMON_HOMARR_API_KEY": "fixture-key", "PATCHMON_HOMARR_API_SECRET": "fixture-secret"},
	})
	descriptor := patchmonTarget()
	if linked, err := descriptor.linked(t.Context(), from, to); linked || !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("Check with a supplied pair must remain Manual: linked=%v err=%v", linked, err)
	}
	if err := descriptor.add(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("apply with a supplied pair must remain Manual: %v", err)
	}
	if readiness != 2 || unexpected != 0 {
		t.Fatalf("hold must read readiness only: readiness=%d unexpected=%d", readiness, unexpected)
	}
}

func TestPatchmonPreparedStatsSemantics(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(statsSample)
		valid  bool
	}{
		{"empty inventory", func(statsSample) {}, true},
		{"populated", func(s statsSample) {
			s.values["totalHosts"] = float64(3)
			s.values["hostsNeedingUpdates"] = float64(2)
			s.values["securityUpdates"] = float64(1)
			s.values["totalOutdatedPackages"] = float64(4)
		}, true},
		{"missing", func(s statsSample) { delete(s.values, "totalHosts") }, false},
		{"null", func(s statsSample) { s.values["totalHosts"] = nil }, false},
		{"fractional", func(s statsSample) { s.values["totalHosts"] = 1.5 }, false},
		{"negative", func(s statsSample) { s.values["totalHosts"] = float64(-1) }, false},
		{"nonfinite", func(s statsSample) { s.values["totalHosts"] = math.Inf(1) }, false},
		{"NaN", func(s statsSample) { s.values["totalHosts"] = math.NaN() }, false},
		{"wrong unit", func(s statsSample) { s.units["totalHosts"] = "bytes" }, false},
		{"excess hosts", func(s statsSample) { s.values["hostsNeedingUpdates"] = float64(1) }, false},
		{"excess security packages", func(s statsSample) { s.values["securityUpdates"] = float64(1) }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			sample := statsSample{values: map[string]any{}, units: map[string]string{}}
			for _, key := range patchmonTarget().statsMetrics() {
				sample.values[key] = float64(0)
				sample.units[key] = "count"
			}
			scenario.change(sample)
			if err := patchmonTarget().stats(sample); (err == nil) != scenario.valid {
				t.Fatalf("prepared callback valid=%v: %v", scenario.valid, err)
			}
		})
	}
}
