package homarr

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type dashdotSecrets map[string]string

func (s dashdotSecrets) Get(key string) string       { return s[key] }
func (s dashdotSecrets) Set(key, value string) error { s[key] = value; return nil }

func dashdotHelpers(t *testing.T, native any, cpuBody string, required [][]string, fixtures ...*statsFixture) (*helpers.H, *helpers.H) {
	t.Helper()
	f := &statsFixture{
		timestamp: 1000, advance: true,
		values: map[string]any{"cpu": float64(0), "memoryUsed": float64(0), "memoryAvailable": float64(8192), "uptime": float64(0)},
		metrics: []any{
			map[string]any{"key": "cpu", "unit": "percent"},
			map[string]any{"key": "memoryUsed", "unit": "bytes"},
			map[string]any{"key": "memoryAvailable", "unit": "bytes"},
			map[string]any{"key": "uptime", "unit": "seconds"},
		},
	}
	if len(fixtures) != 0 {
		f = fixtures[0]
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var value any
		switch r.URL.Path {
		case "/config":
			w.Write([]byte(`{"config":{"widget_list":["cpu","ram"],"running_in_docker":false,"disable_background_stats_collection":true,"disable_integrations":false,"enable_cpu_temps":false}}`))
			return
		case "/info":
			w.Write([]byte(`{"cpu":{"brand":"Kernel CPU","model":"Model","threads":2},"ram":{"size":8192}}`))
			return
		case "/load/cpu":
			w.Write([]byte(cpuBody))
			return
		case "/load/ram":
			w.Write([]byte(`{"load":0}`))
			return
		case "/api/trpc/info.getInfo":
			value = map[string]string{"version": "2.4.1"}
		case "/api/trpc/integration.getKinds":
			value = []any{map[string]any{"kind": "dashDot", "requiredSecrets": required}}
		case "/api/trpc/widget.stats.catalog", "/api/trpc/widget.stats.snapshot", "/api/trpc/widget.stats.refresh":
			var input struct {
				JSON struct {
					IntegrationID string `json:"integrationId"`
					Force         bool   `json:"force"`
				} `json:"json"`
			}
			if r.Method == http.MethodPost {
				json.NewDecoder(r.Body).Decode(&input)
			} else {
				json.Unmarshal([]byte(r.URL.Query().Get("input")), &input)
			}
			if input.JSON.IntegrationID != "owned-dashdot" {
				t.Error("Stats query selected an unowned integration")
			}
			switch r.URL.Path {
			case "/api/trpc/widget.stats.catalog":
				f.catalogs++
				value = map[string]any{"metrics": f.metrics}
			case "/api/trpc/widget.stats.snapshot":
				value = map[string]any{"updatedAt": f.timestamp}
			case "/api/trpc/widget.stats.refresh":
				f.refreshes++
				f.force = input.JSON.Force
				if f.advance {
					f.timestamp++
				}
				value = map[string]any{"updatedAt": f.timestamp, "error": false, "stale": false, "values": f.values}
			}
		case "/api/trpc/widget.healthMonitoring.getSystemHealthStatus":
			var input struct {
				JSON struct {
					IntegrationIDs []string `json:"integrationIds"`
				} `json:"json"`
			}
			if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil || !reflect.DeepEqual(input.JSON.IntegrationIDs, []string{"owned-dashdot"}) {
				t.Error("native query did not select only the owned integration")
			}
			value = native
		default:
			t.Errorf("unexpected endpoint: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("ApiKey") != "homarr-test-key" {
			t.Error("native query was not authenticated with Homarr")
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(srv.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: dashdotSecrets{"HOMARR_API_KEY": "homarr-test-key"}})
	to := helpers.New(helpers.Config{App: "dashdot", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard()})
	return from, to
}

func TestDashdotDescriptorUsesNativeCPURAMAndDefinedStats(t *testing.T) {
	target := dashdotTarget()
	if target.id != "dashdot" || target.kind != "dashDot" || target.internal(nil) != "http://dashdot:3001" {
		t.Fatal("descriptor does not match the upstream kind and internal Address")
	}
	credentials, err := json.Marshal(target.secrets(nil, nil))
	if err != nil || string(credentials) != "[]" {
		t.Fatal("Dash. must submit the explicit no-credential alternative")
	}
	if len(target.widgets) != 2 || target.widgets[0].kind != "systemResources" ||
		!reflect.DeepEqual(target.widgets[0].options["visibleCharts"], []string{"cpu", "memory"}) ||
		!reflect.DeepEqual(target.widgets[1].metrics, []string{"cpu", "memoryUsed", "memoryAvailable", "uptime"}) {
		t.Fatal("descriptor should not enable unavailable disk, GPU or network charts")
	}
	if target.link().Target != "dashdot" || target.link().Remove == nil {
		t.Fatal("descriptor bypasses the shared Link lifecycle")
	}
}

func TestDashdotCompatibilityRequiresTheNoCredentialAlternative(t *testing.T) {
	for _, tc := range []struct {
		name     string
		required [][]string
		valid    bool
	}{
		{"no credentials", [][]string{{}}, true},
		{"unexpected authentication", [][]string{{"apiKey"}}, false},
		{"missing alternative", [][]string{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			from, to := dashdotHelpers(t, nil, `[]`, tc.required)
			err := dashdotTarget().compatible(context.Background(), from, to)
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected compatibility: %v", err)
			}
		})
	}
}

func TestDashdotVerificationRequiresRawAndNativeDefinedNumbers(t *testing.T) {
	validHealth := map[string]any{"cpuUtilization": 0, "memUsedInBytes": 0, "memAvailableInBytes": 8192, "uptime": 0}
	for _, tc := range []struct {
		name, cpuBody string
		native        any
		valid         bool
	}{
		{"explicit zeros", `[{"load":0,"temp":0}]`, []any{map[string]any{"integrationId": "owned-dashdot", "healthInfo": validHealth}}, true},
		{"empty raw CPU cannot use native fallback zero", `[]`, []any{map[string]any{"integrationId": "owned-dashdot", "healthInfo": validHealth}}, false},
		{"empty native result", `[{"load":0,"temp":0}]`, []any{}, false},
		{"unavailable native data", `[{"load":0,"temp":0}]`, []any{map[string]any{"integrationId": "owned-dashdot", "healthInfo": nil, "error": "unavailable"}}, false},
		{"wrong integration", `[{"load":0,"temp":0}]`, []any{map[string]any{"integrationId": "user-dashdot", "healthInfo": validHealth}}, false},
		{"missing native field", `[{"load":0,"temp":0}]`, []any{map[string]any{"integrationId": "owned-dashdot", "healthInfo": map[string]any{"cpuUtilization": 0, "memUsedInBytes": 0, "uptime": 0}}}, false},
		{"zero total memory", `[{"load":0,"temp":0}]`, []any{map[string]any{"integrationId": "owned-dashdot", "healthInfo": map[string]any{"cpuUtilization": 0, "memUsedInBytes": 0, "memAvailableInBytes": 0, "uptime": 0}}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			from, to := dashdotHelpers(t, tc.native, tc.cpuBody, [][]string{{}})
			err := dashdotTarget().verifyData(context.Background(), from, to, "owned-dashdot")
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if err != nil && !strings.Contains(err.Error(), "self-host setup") {
				t.Fatalf("verification lacks recovery instruction: %v", err)
			}
		})
	}
}

func TestDashdotStatsUseOneFreshOwnedSample(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*statsFixture)
		valid  bool
	}{
		{"volatile native and Stats may differ", func(f *statsFixture) { f.values["cpu"] = float64(25) }, true},
		{"zero CPU and used RAM", func(*statsFixture) {}, true},
		{"wrong unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"missing catalog metric", func(f *statsFixture) { f.metrics = f.metrics[:3] }, false},
		{"null value", func(f *statsFixture) { f.values["uptime"] = nil }, false},
		{"negative byte value", func(f *statsFixture) { f.values["memoryUsed"] = float64(-1) }, false},
		{"fractional byte value", func(f *statsFixture) { f.values["memoryUsed"] = 0.5 }, false},
		{"CPU over 100", func(f *statsFixture) { f.values["cpu"] = float64(101) }, false},
		{"zero total memory", func(f *statsFixture) { f.values["memoryAvailable"] = float64(0) }, false},
		{"cached refresh", func(f *statsFixture) { f.advance = false }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &statsFixture{
				timestamp: 1000, advance: true,
				values: map[string]any{"cpu": float64(0), "memoryUsed": float64(0), "memoryAvailable": float64(8192), "uptime": float64(0)},
				metrics: []any{
					map[string]any{"key": "cpu", "unit": "percent"},
					map[string]any{"key": "memoryUsed", "unit": "bytes"},
					map[string]any{"key": "memoryAvailable", "unit": "bytes"},
					map[string]any{"key": "uptime", "unit": "seconds"},
				},
			}
			tc.change(f)
			health := []any{map[string]any{"integrationId": "owned-dashdot", "healthInfo": map[string]any{"cpuUtilization": 0, "memUsedInBytes": 0, "memAvailableInBytes": 8192, "uptime": 0}}}
			from, to := dashdotHelpers(t, health, `[{"load":0,"temp":0}]`, [][]string{{}}, f)
			err := dashdotTarget().verifyData(context.Background(), from, to, "owned-dashdot")
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected verification result: %v", err)
			}
			if f.refreshes > 1 || f.refreshes == 1 && !f.force || tc.valid && (f.refreshes != 1 || f.catalogs != 1) {
				t.Fatalf("Stats acquisition duplicated or did not force refresh: %+v", f)
			}
		})
	}
}

func TestDashdotStatsRejectNonfiniteValues(t *testing.T) {
	for _, bad := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		for _, key := range []string{"cpu", "memoryUsed", "memoryAvailable", "uptime"} {
			sample := statsSample{
				values: map[string]any{"cpu": float64(0), "memoryUsed": float64(0), "memoryAvailable": float64(8192), "uptime": float64(0)},
				units:  map[string]string{"cpu": "percent", "memoryUsed": "bytes", "memoryAvailable": "bytes", "uptime": "seconds"},
			}
			sample.values[key] = bad
			if verifyDashdotStats(sample) == nil {
				t.Fatalf("accepted nonfinite %s Stats", key)
			}
		}
	}
}
