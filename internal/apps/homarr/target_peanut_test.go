package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestPeanutDescriptorVerifyData(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*statsFixture)
		wantError bool
	}{
		{"one UPS", nil, false},
		{"independent zero counts", func(f *statsFixture) { f.values["devices"] = float64(0) }, false},
		{"independent UPS count", func(f *statsFixture) {
			f.values["devices"] = float64(2)
			f.values["onBattery"] = float64(1)
			f.values["lowBattery"] = float64(1)
		}, false},
		{"invalid first sample", func(f *statsFixture) { f.values["devices"] = float64(-1) }, true},
		{"fractional count", func(f *statsFixture) { f.values["onBattery"] = 0.5 }, true},
		{"negative battery count", func(f *statsFixture) { f.values["lowBattery"] = float64(-1) }, true},
		{"status counts exceed devices", func(f *statsFixture) { f.values["onBattery"] = float64(1); f.values["lowBattery"] = float64(1) }, true},
		{"wrong unit", func(f *statsFixture) { f.metrics[1] = map[string]any{"key": "onBattery", "unit": "percent"} }, true},
		{"missing count", func(f *statsFixture) { delete(f.values, "lowBattery") }, true},
		{"null count", func(f *statsFixture) { f.values["devices"] = nil }, true},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values = map[string]any{"devices": float64(1), "onBattery": float64(0), "lowBattery": float64(0)}
			fixture.metrics = []any{}
			for _, key := range []string{"devices", "onBattery", "lowBattery"} {
				fixture.metrics = append(fixture.metrics, map[string]any{"key": key, "unit": "count"})
			}
			if scenario.change != nil {
				scenario.change(fixture)
			}
			from, to := peanutDescriptorHelpers(t, fixture, "")
			err := peanutTarget().verifyData(t.Context(), from, to, "peanut-owned")
			if (err != nil) != scenario.wantError {
				t.Fatalf("verifyData: %v", err)
			}
			if fixture.refreshes != 1 || fixture.catalogs != 1 || !fixture.force || fixture.integrationID != "peanut-owned" {
				t.Fatalf("expected exactly one owned forced refresh: %+v", fixture)
			}
		})
	}
}

func TestPeanutDescriptorRejectsNativeDataBeforeStats(t *testing.T) {
	for _, failure := range []string{"authentication", "missing device metadata", "empty devices", "integration", "source error", "UPS id", "status", "battery", "unavailable voltage", "voltage", "load"} {
		t.Run(failure, func(t *testing.T) {
			fixture := newStatsFixture()
			from, to := peanutDescriptorHelpers(t, fixture, failure)
			err := peanutTarget().verifyData(t.Context(), from, to, "peanut-owned")
			if err == nil || fixture.catalogs != 0 || fixture.refreshes != 0 {
				t.Fatalf("native failure reached Stats: %v", err)
			}
		})
	}
}

func peanutDescriptorHelpers(t *testing.T, fixture *statsFixture, failure string) (*helpers.H, *helpers.H) {
	t.Helper()
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, _ := r.BasicAuth()
		if user != "fixture-admin" || pass != "fixture-password" || failure == "authentication" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/api/v1/info" {
			json.NewEncoder(w).Encode(map[string]any{"version": "6.0.0"})
			return
		}
		if r.URL.Path != "/api/v1/devices" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		devices := []any{map[string]any{"peanut.device_id": "native-ups", "peanut.server": "native-server", "ups.status": "OL", "battery.charge": "42"}}
		if failure == "missing device metadata" {
			delete(devices[0].(map[string]any), "peanut.server")
		}
		if failure == "empty devices" {
			devices = []any{}
		}
		if failure == "voltage" {
			devices[0].(map[string]any)["input.voltage"] = "230"
		}
		json.NewEncoder(w).Encode(devices)
	}))
	t.Cleanup(peer.Close)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/api/trpc/widget.ups.getSummaries" {
			fixture.ServeHTTP(w, r)
			return
		}
		summary := map[string]any{"id": "native-ups", "status": "online", "batteryCharge": float64(42), "batteryRuntime": nil, "batteryVoltage": nil, "load": nil, "inputVoltage": nil, "outputVoltage": nil}
		instance := map[string]any{"integrationId": "peanut-owned", "summaries": []any{summary}}
		switch failure {
		case "integration":
			instance["integrationId"] = "other"
		case "source error":
			instance["error"] = "unavailable"
		case "UPS id":
			summary["id"] = "ups-0"
		case "status":
			summary["status"] = "unknown"
		case "battery":
			summary["batteryCharge"] = float64(101)
		case "unavailable voltage":
			summary["inputVoltage"] = float64(0)
		case "voltage":
			summary["inputVoltage"] = nil
		case "load":
			delete(summary, "load")
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": []any{instance}}}})
	}))
	t.Cleanup(server.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
	to := helpers.New(helpers.Config{App: "peanut", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{"ADMIN_USER": "fixture-admin", "ADMIN_PASSWORD": "fixture-password"}})
	return from, to
}
