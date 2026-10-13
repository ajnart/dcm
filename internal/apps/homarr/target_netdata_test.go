package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func TestNetdataStatsUseOneFreshSampleAfterNativeCPU(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		valid  bool
	}{
		{"zero alarms", func(*statsFixture) {}, true},
		{"positive alarms", func(f *statsFixture) { f.values["warnings"] = float64(2) }, true},
		{"negative alarms", func(f *statsFixture) { f.values["warnings"] = float64(-1) }, false},
		{"fractional alarms", func(f *statsFixture) { f.values["criticals"] = 0.5 }, false},
		{"null alarms", func(f *statsFixture) { f.values["criticals"] = nil }, false},
		{"missing alarms", func(f *statsFixture) { delete(f.values, "warnings") }, false},
		{"wrong units", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, false},
		{"missing catalog metric", func(f *statsFixture) { f.metrics = f.metrics[:1] }, false},
		{"no-op refresh", func(f *statsFixture) { f.advance = false }, false},
		{"old refresh", func(f *statsFixture) { f.timestamp -= 1000 }, false},
		{"future refresh", func(f *statsFixture) { f.timestamp += 30_001 }, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			now := time.Now()
			fixture.timestamp = float64(now.UnixMilli() - 1)
			fixture.values = map[string]any{"warnings": float64(0), "criticals": float64(0)}
			fixture.metrics = []any{map[string]any{"key": "warnings", "unit": "count"}, map[string]any{"key": "criticals", "unit": "count"}}
			scenario.change(fixture)
			from := fixture.helpers(t)
			from.Now = func() time.Time { return now }
			to, reads := netdataLeafFixture(t, now, []string{"time", "system", "user"}, http.StatusOK)
			err := netdataTarget().verifyData(t.Context(), from, to, "netdata-owned")
			if (err == nil) != scenario.valid {
				t.Fatalf("valid=%v, got %v", scenario.valid, err)
			}
			refreshes := 1
			if scenario.name == "missing catalog metric" {
				refreshes = 0
			}
			if *reads != 3 || fixture.catalogs != 1 || fixture.refreshes != refreshes {
				t.Fatalf("native reads=%d catalogs=%d refreshes=%d", *reads, fixture.catalogs, fixture.refreshes)
			}
			if scenario.valid && (fixture.refreshes != 1 || !fixture.force) {
				t.Fatal("valid alarms must use one forced fresh sample")
			}
		})
	}
}

func TestNetdataSlowRefreshUsesCompletionClockWindow(t *testing.T) {
	fixture := newStatsFixture()
	now := time.Now()
	fixture.timestamp = float64(now.UnixMilli() + 45_000 - 1)
	fixture.values = map[string]any{"warnings": float64(0), "criticals": float64(0)}
	fixture.metrics = []any{map[string]any{"key": "warnings", "unit": "count"}, map[string]any{"key": "criticals", "unit": "count"}}
	from := fixture.helpers(t)
	calls := 0
	from.Now = func() time.Time {
		calls++
		if calls == 1 {
			return now
		}
		return now.Add(45 * time.Second)
	}
	to, _ := netdataLeafFixture(t, now, []string{"time", "user", "system"}, http.StatusOK)
	if err := netdataTarget().verifyData(t.Context(), from, to, "netdata-owned"); err != nil || fixture.refreshes != 1 {
		t.Fatalf("completed slow refresh must retain the after-response window: err=%v refreshes=%d", err, fixture.refreshes)
	}
}

func TestNetdataNativeFailureStopsBeforeStats(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		labels []string
		status int
		manual bool
	}{
		{"unrelated CPU dimension", []string{"time", "idle", "user"}, http.StatusOK, false},
		{"duplicate CPU dimension", []string{"time", "user", "user"}, http.StatusOK, false},
		{"protected API", nil, http.StatusForbidden, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			from := fixture.helpers(t)
			to, _ := netdataLeafFixture(t, time.Now(), scenario.labels, scenario.status)
			err := netdataTarget().verifyData(t.Context(), from, to, "netdata-owned")
			if err == nil || errors.Is(err, helpers.ErrManual) != scenario.manual || fixture.catalogs != 0 || fixture.refreshes != 0 {
				t.Fatalf("native failure reached Stats: err=%v catalogs=%d refreshes=%d", err, fixture.catalogs, fixture.refreshes)
			}
		})
	}
}

func netdataLeafFixture(t *testing.T, now time.Time, labels []string, status int) (*helpers.H, *int) {
	t.Helper()
	reads := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
			t.Error("Netdata native probe changed its read-only no-auth scope")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		switch r.URL.Path {
		case "/api/v1/info":
			w.Write([]byte(`{"alarms":{"warning":0,"critical":0}}`))
		case "/api/v1/charts":
			w.Write([]byte(`{"charts":{"native":{"id":"netdata.server_cpu","context":"netdata.server_cpu","plugin":"netdata","module":"pulse","units":"milliseconds/s"}}}`))
		case "/api/v1/data":
			q := r.URL.Query()
			if q.Get("chart") != "netdata.server_cpu" || q.Get("after") != "-60" || q.Get("points") != "1" || q.Get("format") != "json" {
				t.Error("Netdata native chart query changed")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"labels": labels, "data": [][]any{{now.Unix(), 0, 0}}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "netdata", BaseURL: srv.URL, HTTP: srv.Client(), Now: func() time.Time { return now }}), &reads
}
