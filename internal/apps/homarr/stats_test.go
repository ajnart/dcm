package homarr

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type statsFixture struct {
	values     map[string]any
	metrics    []any
	timestamp  float64
	advance    bool
	refreshes  int
	catalogs   int
	snapshots  int
	force      bool
	beforeRaw  string
	afterRaw   string
	retryAt    any
	hasRetryAt bool
}

func newStatsFixture() *statsFixture {
	return &statsFixture{
		timestamp: 1000, advance: true,
		values:  map[string]any{"requests": float64(-1)},
		metrics: []any{map[string]any{"key": "requests", "unit": "count"}},
	}
}

func (f *statsFixture) helpers(t *testing.T) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api/trpc/widget.stats.catalog":
			f.catalogs++
			value = map[string]any{"metrics": f.metrics}
		case "/api/trpc/widget.stats.snapshot":
			f.snapshots++
			if f.beforeRaw != "" {
				w.Write([]byte(`{"result":{"data":{"json":{"updatedAt":` + f.beforeRaw + `}}}}`))
				return
			}
			value = map[string]any{"updatedAt": f.timestamp, "retryAt": float64(9000)}
		case "/api/trpc/widget.stats.refresh":
			f.refreshes++
			var input struct {
				JSON struct {
					Force bool `json:"force"`
				} `json:"json"`
			}
			json.NewDecoder(r.Body).Decode(&input)
			f.force = input.JSON.Force
			if f.advance {
				f.timestamp++
			}
			if f.afterRaw != "" {
				w.Write([]byte(`{"result":{"data":{"json":{"updatedAt":` + f.afterRaw + `,"error":false,"stale":false,"values":{"requests":0}}}}}`))
				return
			}
			values := f.values
			if f.refreshes > 1 {
				values = map[string]any{"requests": float64(0)}
			}
			refreshed := map[string]any{"updatedAt": f.timestamp, "error": false, "stale": false, "values": values}
			if f.hasRetryAt {
				refreshed["retryAt"] = f.retryAt
			}
			value = refreshed
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{
		App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(),
		Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"},
	})
}

type statsSecrets map[string]string

func (s statsSecrets) Get(key string) string       { return s[key] }
func (s statsSecrets) Set(key, value string) error { s[key] = value; return nil }

func statsTarget(check func(statsSample) error) target {
	return target{
		widgets: []widget{statWidget("requests"), statWidget("requests")},
		verify: func(context.Context, *helpers.H, *helpers.H, string) error {
			return nil
		},
		stats: check,
	}
}

func TestStatsVerificationRejectsTheFirstRefreshedSample(t *testing.T) {
	fixture := newStatsFixture()
	h := fixture.helpers(t)
	invalidCount := errors.New("invalid Caddy request count")
	target := statsTarget(func(sample statsSample) error {
		count, ok := sample.values["requests"].(float64)
		if !ok || count < 0 {
			return invalidCount
		}
		return nil
	})
	if err := target.verifyData(t.Context(), h, h, "caddy-owned"); !errors.Is(err, invalidCount) {
		t.Fatalf("first refreshed sample must fail semantic validation: %v", err)
	}
	if fixture.refreshes != 1 {
		t.Fatalf("semantic failure refreshed %d times, want one sample", fixture.refreshes)
	}
}

func TestStatsVerificationAcceptsExplicitZeroWithOneRefresh(t *testing.T) {
	fixture := newStatsFixture()
	fixture.values["requests"] = float64(0)
	fixture.afterRaw = "45000"
	h := fixture.helpers(t)
	h.Now = func() time.Time {
		if fixture.refreshes == 0 {
			return time.UnixMilli(2000)
		}
		return time.UnixMilli(47000)
	}
	validated := false
	target := statsTarget(func(sample statsSample) error {
		validated = true
		if sample.values["requests"] != float64(0) || sample.units["requests"] != "count" || sample.updatedAt != 45000 || sample.startedAt != 2000 || sample.completedAt != 47000 {
			return errors.New("unexpected refreshed sample")
		}
		return nil
	})
	if err := target.verifyData(t.Context(), h, h, "caddy-owned"); err != nil {
		t.Fatal(err)
	}
	if !validated || fixture.refreshes != 1 || fixture.catalogs != 1 || !fixture.force {
		t.Fatalf("selected duplicate metrics must share one forced semantic sample: validated=%v refreshes=%d catalogs=%d force=%v", validated, fixture.refreshes, fixture.catalogs, fixture.force)
	}
}

func TestStatsVerificationPreservesRefreshedRetryAt(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		present bool
		value   any
	}{
		{"absent", false, nil},
		{"null", true, nil},
		{"numeric zero", true, float64(0)},
		{"pending retry", true, float64(5000)},
		{"text zero", true, "0"},
		{"boolean", true, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.values["requests"] = float64(0)
			fixture.hasRetryAt, fixture.retryAt = scenario.present, scenario.value
			h := fixture.helpers(t)
			validated := false
			target := statsTarget(func(sample statsSample) error {
				validated = true
				if sample.retryAt != scenario.value {
					return errors.New("retry metadata differs from the refreshed response")
				}
				return nil
			})
			if err := target.verifyData(t.Context(), h, h, "caddy-owned"); err != nil {
				t.Fatal(err)
			}
			if !validated || fixture.refreshes != 1 || fixture.catalogs != 1 || fixture.snapshots != 1 || !fixture.force {
				t.Fatalf("retry metadata must share one forced sample: validated=%v refreshes=%d catalogs=%d snapshots=%d force=%v", validated, fixture.refreshes, fixture.catalogs, fixture.snapshots, fixture.force)
			}
		})
	}
}

func TestStatsVerificationRejectsUnavailableMetrics(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
	}{
		{"missing value", func(f *statsFixture) { delete(f.values, "requests") }},
		{"null value", func(f *statsFixture) { f.values["requests"] = nil }},
		{"missing catalog metric", func(f *statsFixture) { f.metrics = []any{} }},
		{"missing catalog unit", func(f *statsFixture) { f.metrics = []any{map[string]any{"key": "requests"}} }},
		{"duplicate catalog metric", func(f *statsFixture) { f.metrics = append(f.metrics, f.metrics[0]) }},
		{"wrong unit", func(f *statsFixture) { f.metrics = []any{map[string]any{"key": "requests", "unit": "bytes"}} }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			scenario.change(fixture)
			h := fixture.helpers(t)
			target := statsTarget(func(sample statsSample) error {
				if sample.units["requests"] != "count" {
					return errors.New("unsupported Caddy count unit")
				}
				return nil
			})
			if err := target.verifyData(t.Context(), h, h, "caddy-owned"); err == nil {
				t.Fatal("unavailable or unsupported selected metric completed verification")
			}
		})
	}
}

func TestStatsVerificationRejectsNoOpBeforeSemantics(t *testing.T) {
	fixture := newStatsFixture()
	fixture.advance = false
	h := fixture.helpers(t)
	validated := false
	target := statsTarget(func(statsSample) error {
		validated = true
		return nil
	})
	err := target.verifyData(t.Context(), h, h, "caddy-owned")
	if err == nil || !strings.Contains(err.Error(), "did not advance") || validated || fixture.refreshes != 1 {
		t.Fatalf("no-op refresh must fail before semantics without retry: err=%v validated=%v refreshes=%d", err, validated, fixture.refreshes)
	}
}

func TestStatsVerificationRejectsInvalidRefreshTimestamps(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		before string
		after  string
	}{
		{"nonfinite before", "1e309", ""},
		{"nonfinite after", "", "1e309"},
		{"zero after", "null", "0"},
		{"negative after", "null", "-1"},
		{"null after", "", "null"},
		{"text after", "", `"1001"`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.beforeRaw, fixture.afterRaw = scenario.before, scenario.after
			h := fixture.helpers(t)
			validated := false
			target := statsTarget(func(statsSample) error { validated = true; return nil })
			if err := target.verifyData(t.Context(), h, h, "caddy-owned"); err == nil || validated {
				t.Fatalf("invalid timestamp reached semantic validation: err=%v validated=%v", err, validated)
			}
		})
	}
}

func TestStatsVerificationKeepsNilAndLegacyBehavior(t *testing.T) {
	fixture := newStatsFixture()
	h := fixture.helpers(t)
	target := statsTarget(func(statsSample) error { return errors.New("unexpected semantic validation") })
	target.verify = nil
	if err := target.verifyData(t.Context(), h, h, "legacy"); err != nil || fixture.refreshes != 0 || fixture.catalogs != 0 {
		t.Fatalf("nil verifier changed legacy behavior: err=%v refreshes=%d catalogs=%d", err, fixture.refreshes, fixture.catalogs)
	}
	target = statsTarget(nil)
	if err := target.verifyData(t.Context(), h, h, "legacy"); err != nil || fixture.refreshes != 2 || fixture.catalogs != 0 {
		t.Fatalf("unmigrated verifier must keep its existing guard without a catalog: err=%v refreshes=%d catalogs=%d", err, fixture.refreshes, fixture.catalogs)
	}
}

func TestStatsVerificationStopsAfterNativeFailure(t *testing.T) {
	fixture := newStatsFixture()
	h := fixture.helpers(t)
	nativeFailure := errors.New("peer identity is unavailable")
	target := statsTarget(func(statsSample) error { return errors.New("unexpected semantic validation") })
	target.verify = func(context.Context, *helpers.H, *helpers.H, string) error { return nativeFailure }
	if err := target.verifyData(t.Context(), h, h, "caddy-owned"); !errors.Is(err, nativeFailure) || fixture.catalogs != 0 || fixture.refreshes != 0 {
		t.Fatalf("native failure must stop before Stats: err=%v catalogs=%d refreshes=%d", err, fixture.catalogs, fixture.refreshes)
	}
}
