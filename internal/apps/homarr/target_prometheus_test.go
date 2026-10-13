package homarr_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
	stepstatus "github.com/ajnart/self-host/internal/status"
)

type prometheusLinkFixture struct {
	*fakeHomarr
	values       map[string]any
	metrics      []any
	timestamp    float64
	advance      bool
	failed       bool
	stale        bool
	refreshes    int
	catalogs     int
	snapshots    int
	sourceStatus int
	sourceAge    time.Duration
	sourceHealth string
	force        bool
}

func newPrometheusLinkFixture() *prometheusLinkFixture {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	return &prometheusLinkFixture{
		fakeHomarr: fake, advance: true, timestamp: 1000,
		sourceStatus: http.StatusOK, sourceHealth: "up",
		values: map[string]any{"total": 2, "up": 0, "down": 1},
		metrics: []any{
			map[string]any{"key": "total", "unit": "count"},
			map[string]any{"key": "up", "unit": "count"},
			map[string]any{"key": "down", "unit": "count"},
		},
	}
}

func (f *prometheusLinkFixture) serve(t *testing.T) (*helpers.H, *helpers.H, fakeSecrets) {
	t.Helper()
	fallback := f.handler()
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/targets", "/api/v1/query", "/api/trpc/integration.getKinds", "/api/trpc/widget.stats.catalog", "/api/trpc/widget.stats.snapshot", "/api/trpc/widget.stats.refresh":
		default:
			fallback.ServeHTTP(w, r)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.URL.Path == "/api/v1/targets" || r.URL.Path == "/api/v1/query" {
			if f.sourceStatus != http.StatusOK {
				w.WriteHeader(f.sourceStatus)
				return
			}
			data := map[string]any{
				"activeTargets": []any{map[string]any{
					"health":    f.sourceHealth,
					"labels":    map[string]string{"job": "prometheus", "instance": "localhost:9090"},
					"scrapeUrl": "http://localhost:9090/metrics",
				}}, "droppedTargets": []any{},
			}
			if r.URL.Path == "/api/v1/query" {
				if r.URL.Query().Get("query") != `up{job="prometheus",instance="localhost:9090"}[1m]` {
					t.Error("unexpected self-scrape selector")
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				data = map[string]any{"resultType": "matrix", "result": []any{map[string]any{
					"metric": map[string]string{"__name__": "up", "job": "prometheus", "instance": "localhost:9090"},
					"values": []any{[]any{now.Add(-f.sourceAge).Unix(), "1"}},
				}}}
			}
			json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": data})
			return
		}
		if !f.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/trpc/integration.getKinds":
			trpc(w, []any{map[string]any{"kind": "prometheus", "requiredSecrets": [][]string{{}, {"username", "password"}}}})
		case "/api/trpc/widget.stats.catalog":
			f.catalogs++
			trpc(w, map[string]any{"metrics": f.metrics})
		case "/api/trpc/widget.stats.snapshot":
			f.snapshots++
			trpc(w, map[string]any{"updatedAt": f.timestamp})
		case "/api/trpc/widget.stats.refresh":
			f.refreshes++
			f.force, _ = inputOf(r)["force"].(bool)
			if f.advance {
				f.timestamp++
			}
			trpc(w, map[string]any{"updatedAt": f.timestamp, "values": f.values, "error": f.failed, "stale": f.stale})
		}
	}))
	t.Cleanup(srv.Close)
	secrets := allSecrets()
	return homarrH(t, srv, secrets), targetH(t, srv, "prometheus", 9090, secrets), secrets
}

func TestPrometheusLinkUsesOneStatsSamplePerVerification(t *testing.T) {
	f := newPrometheusLinkFixture()
	from, to, secrets := f.serve(t)
	link := linkFor(t, "prometheus")
	if err := link.Apply(t.Context(), from, to); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	if f.refreshes != 2 || f.catalogs != 2 || f.snapshots != 2 || !f.force {
		t.Fatalf("initial apply/post-check: refreshes=%d catalogs=%d snapshots=%d force=%v", f.refreshes, f.catalogs, f.snapshots, f.force)
	}
	if len(f.integrations) != 1 || f.integrations[0]["url"] != "http://prometheus:9090" || len(f.integrations[0]["secrets"].([]any)) != 0 {
		t.Fatal("no-auth Link did not preserve the internal Address and explicit empty credentials")
	}
	id := secrets["HOMARR_LINKED_PROMETHEUS"]
	if id == "" || widgetCount(f.items, "stats", id) != 1 {
		t.Fatal("owned Prometheus Stats binding missing")
	}
	for _, item := range f.items {
		if item["kind"] == "stats" && len(item["options"].(map[string]any)["entries"].([]any)) != 3 {
			t.Fatal("Prometheus must expose exactly total/up/down")
		}
	}
	f.values = map[string]any{"total": 0, "up": 0, "down": 0}
	f.mu.Unlock()
	var status stepstatus.Step
	from.Record = func(result helpers.StepResult) { status = result.Status }
	if err := link.Apply(t.Context(), from, to); err != nil || status != stepstatus.StepSkip {
		t.Fatalf("zero-count rerun: err=%v status=%s", err, status)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refreshes != 3 || f.catalogs != 3 || f.snapshots != 3 || len(f.integrations) != 1 || secrets["HOMARR_LINKED_PROMETHEUS"] != id {
		t.Fatal("rerun did not reuse ownership and one semantic sample")
	}
}

func TestPrometheusLinkRejectsInvalidStats(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*prometheusLinkFixture)
	}{
		{"negative", func(f *prometheusLinkFixture) { f.values["up"] = -1 }},
		{"fraction", func(f *prometheusLinkFixture) { f.values["down"] = 0.5 }},
		{"text", func(f *prometheusLinkFixture) { f.values["total"] = "2" }},
		{"null", func(f *prometheusLinkFixture) { f.values["up"] = nil }},
		{"missing", func(f *prometheusLinkFixture) { delete(f.values, "down") }},
		{"inconsistent", func(f *prometheusLinkFixture) { f.values["up"] = 2 }},
		{"unit", func(f *prometheusLinkFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }},
		{"no-op", func(f *prometheusLinkFixture) { f.advance = false }},
		{"failed", func(f *prometheusLinkFixture) { f.failed = true }},
		{"stale", func(f *prometheusLinkFixture) { f.stale = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newPrometheusLinkFixture()
			tc.change(f)
			from, to, _ := f.serve(t)
			if err := linkFor(t, "prometheus").Apply(t.Context(), from, to); err == nil {
				t.Fatal("invalid first Stats sample completed public Link")
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.refreshes != 1 || f.catalogs != 1 || f.snapshots != 1 {
				t.Fatalf("invalid first sample must stop without a second refresh: %d/%d/%d", f.refreshes, f.catalogs, f.snapshots)
			}
		})
	}
}

func TestPrometheusLinkPreflightStopsBeforeMutation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*prometheusLinkFixture)
	}{
		{"rejected credentials", func(f *prometheusLinkFixture) { f.sourceStatus = http.StatusUnauthorized }},
		{"stale source sample", func(f *prometheusLinkFixture) { f.sourceAge = 61 * time.Second }},
		{"future source sample", func(f *prometheusLinkFixture) { f.sourceAge = -6 * time.Second }},
		{"health mismatch", func(f *prometheusLinkFixture) { f.sourceHealth = "down" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newPrometheusLinkFixture()
			tc.change(f)
			from, to, _ := f.serve(t)
			var status stepstatus.Step
			from.Record = func(result helpers.StepResult) { status = result.Status }
			err := linkFor(t, "prometheus").Apply(t.Context(), from, to)
			if err == nil && status != stepstatus.StepManual {
				t.Fatal("invalid native observation completed public Link")
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if len(f.apps) != 0 || len(f.integrations) != 0 || len(f.items) != 0 || f.catalogs != 0 || f.refreshes != 0 {
				t.Fatal("failed preflight mutated Homarr or read Stats")
			}
		})
	}
}
