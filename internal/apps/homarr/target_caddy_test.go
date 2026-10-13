package homarr_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/helpers"
)

type caddyLinkFixture struct {
	mu        sync.Mutex
	refreshes int
	catalogs  int
	probes    int
	timestamp int
	invalidAt int
	metric    string
	value     any
	unit      string
	native    string
}

func (f *caddyLinkFixture) link(t *testing.T) (app.Link, *helpers.H, *helpers.H) {
	t.Helper()
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fallback := fake.handler()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.URL.Path == "/reverse_proxy/upstreams" {
			f.probes++
			w.Write([]byte(f.native))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/trpc/") && !fake.keyOK(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/trpc/integration.getKinds":
			trpc(w, []any{map[string]any{"kind": "caddy", "requiredSecrets": [][]string{{}}}})
		case "/api/trpc/widget.stats.catalog":
			f.catalogs++
			metrics := []any{}
			for _, key := range []string{"upstreams", "requests", "requestsFailed"} {
				unit := "count"
				if key == f.metric && f.unit != "" {
					unit = f.unit
				}
				metrics = append(metrics, map[string]any{"key": key, "unit": unit})
			}
			trpc(w, map[string]any{"metrics": metrics})
		case "/api/trpc/widget.stats.snapshot":
			trpc(w, map[string]any{"updatedAt": f.timestamp})
		case "/api/trpc/widget.stats.refresh":
			f.refreshes++
			if r.Method != "POST" || inputOf(r)["force"] != true {
				t.Error("Caddy verification must force a Stats refresh")
			}
			f.timestamp++
			values := map[string]any{"upstreams": 0, "requests": 0, "requestsFailed": 0}
			if f.refreshes == f.invalidAt {
				values[f.metric] = f.value
			}
			trpc(w, map[string]any{"updatedAt": f.timestamp, "error": false, "stale": false, "values": values})
		default:
			fallback.ServeHTTP(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return linkFor(t, "caddy"), homarrH(t, srv, fakeSecrets{"HOMARR_API_KEY": fake.apiKey}), targetH(t, srv, "caddy", 2015, fakeSecrets{})
}

func (f *caddyLinkFixture) requireInvocations(t *testing.T, want int) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.refreshes != want || f.catalogs != want || f.probes != want {
		t.Fatalf("Caddy verification: native=%d catalogs=%d refreshes=%d, want %d each", f.probes, f.catalogs, f.refreshes, want)
	}
}

func TestCaddyLinkRejectsInvalidFirstSampleWithoutRefreshingAgain(t *testing.T) {
	for _, metric := range []string{"upstreams", "requests", "requestsFailed"} {
		for _, value := range []any{-1, 0.5, "0"} {
			t.Run(metric+"/"+fmt.Sprint(value), func(t *testing.T) {
				fixture := &caddyLinkFixture{timestamp: 1000, invalidAt: 1, metric: metric, value: value, native: "[]"}
				link, from, to := fixture.link(t)
				if err := link.Apply(t.Context(), from, to); err == nil || !strings.Contains(err.Error(), "incomplete Caddy statistics") {
					t.Fatalf("first semantic failure must fail the public Link: %v", err)
				}
				fixture.requireInvocations(t, 1)
			})
		}
	}
}

func TestCaddyLinkRejectsWrongMetricUnits(t *testing.T) {
	for _, metric := range []string{"upstreams", "requests", "requestsFailed"} {
		t.Run(metric, func(t *testing.T) {
			fixture := &caddyLinkFixture{timestamp: 1000, metric: metric, unit: "bytes", native: "[]"}
			link, from, to := fixture.link(t)
			if err := link.Apply(t.Context(), from, to); err == nil {
				t.Fatal("Caddy count with a different catalog unit completed the public Link")
			}
			fixture.requireInvocations(t, 1)
		})
	}
}

func TestCaddyLinkAcceptsZeroWithOneRefreshPerVerification(t *testing.T) {
	fixture := &caddyLinkFixture{timestamp: 1000, native: "[]"}
	link, from, to := fixture.link(t)
	if err := link.Apply(t.Context(), from, to); err != nil {
		t.Fatal(err)
	}
	// Apply and Step's post-check are separate verification invocations.
	fixture.requireInvocations(t, 2)
	if err := link.Apply(t.Context(), from, to); err != nil {
		t.Fatal(err)
	}
	fixture.requireInvocations(t, 3)
}

func TestCaddyLinkValidatesPostCheckSample(t *testing.T) {
	fixture := &caddyLinkFixture{timestamp: 1000, invalidAt: 2, metric: "requests", value: -1, native: "[]"}
	link, from, to := fixture.link(t)
	if err := link.Apply(t.Context(), from, to); err == nil || !strings.Contains(err.Error(), "incomplete Caddy statistics") {
		t.Fatalf("invalid post-check sample must fail the public Link: %v", err)
	}
	fixture.requireInvocations(t, 2)
}

func TestCaddyLinkKeepsNativeUpstreamValidation(t *testing.T) {
	fixture := &caddyLinkFixture{timestamp: 1000, native: `[{"address":"backend:8080","num_requests":0}]`}
	link, from, to := fixture.link(t)
	if err := link.Apply(t.Context(), from, to); err == nil || !strings.Contains(err.Error(), "incomplete upstream statistics") {
		t.Fatalf("native missing counter must fail before Stats: %v", err)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.probes != 1 || fixture.catalogs != 0 || fixture.refreshes != 0 {
		t.Fatalf("native failure acquired Stats: native=%d catalogs=%d refreshes=%d", fixture.probes, fixture.catalogs, fixture.refreshes)
	}
}
