package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func piholeVerifyFixture(t *testing.T, stats *statsFixture, summary map[string]any, sudo bool) (*helpers.H, *helpers.H) {
	t.Helper()
	from := stats.helpers(t)
	statsURL, err := url.Parse(from.BaseURL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(statsURL)
	homarr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trpc/widget.dnsHole.summary" {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": []any{map[string]any{"integrationId": "pihole-owned", "error": nil, "summary": summary}}}}})
	}))
	t.Cleanup(homarr.Close)
	from.BaseURL = homarr.URL
	from.Now = func() time.Time { return time.UnixMilli(1001) }
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body any
		switch r.URL.Path {
		case "/api/info/login":
			body = map[string]any{"dns": true}
		case "/api/auth":
			if r.Method == http.MethodPost {
				var login map[string]string
				if json.NewDecoder(r.Body).Decode(&login) != nil || login["password"] != "fixture-application-password" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				body = map[string]any{"session": map[string]any{"valid": true, "sid": "fixture-session"}}
			} else if r.Method == http.MethodDelete && r.Header.Get("X-FTL-SID") == "fixture-session" {
				w.WriteHeader(http.StatusNoContent)
				return
			} else {
				t.Errorf("unexpected authentication request %s", r.Method)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
		default:
			if r.Method != http.MethodGet || r.Header.Get("X-FTL-SID") != "fixture-session" {
				t.Error("source probe lost read-only application session")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			switch r.URL.Path {
			case "/api/auth/sessions":
				body = map[string]any{"sessions": []any{map[string]any{"current_session": true, "valid": true, "app": true, "cli": false}}}
			case "/api/config/webserver/api/app_sudo":
				body = map[string]any{"config": map[string]any{"webserver": map[string]any{"api": map[string]any{"app_sudo": sudo}}}}
			case "/api/config/webserver/api/app_pwhash":
				body = map[string]any{"config": map[string]any{"webserver": map[string]any{"api": map[string]any{"app_pwhash": "fixture-owned-hash"}}}}
			case "/api/stats/summary":
				body = map[string]any{"queries": map[string]any{"total": 0, "blocked": 0, "percent_blocked": 0}, "gravity": map[string]any{"domains_being_blocked": 0}}
			case "/api/dns/blocking":
				body = map[string]any{"blocking": "disabled"}
			default:
				t.Errorf("unexpected source request %s", r.URL.Path)
				w.WriteHeader(http.StatusNotFound)
				return
			}
		}
		json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(peer.Close)
	to := helpers.New(helpers.Config{App: "pihole", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Secrets: statsSecrets{"PIHOLE_HOMARR_APP_PASSWORD": "fixture-application-password", "PIHOLE_HOMARR_APP_PASSWORD_HASH": "fixture-owned-hash", "ADMIN_PASSWORD": "fixture-admin-password"}})
	return from, to
}

func piholeStatsFixture() *statsFixture {
	stats := newStatsFixture()
	stats.values = map[string]any{"dnsQueriesToday": float64(0), "adsBlockedToday": float64(0), "adsBlockedTodayPercentage": float64(0), "domainsBeingBlocked": float64(0)}
	stats.metrics = []any{}
	for _, key := range []string{"dnsQueriesToday", "adsBlockedToday", "domainsBeingBlocked"} {
		stats.metrics = append(stats.metrics, map[string]any{"key": key, "unit": "count"})
	}
	stats.metrics = append(stats.metrics, map[string]any{"key": "adsBlockedTodayPercentage", "unit": "percent"})
	return stats
}

func TestPiholeVerifyDataUsesOneFreshSemanticSample(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*statsFixture)
		fail   bool
	}{
		{"explicit zeros", func(*statsFixture) {}, false},
		{"populated differing native sample", func(f *statsFixture) {
			f.values["dnsQueriesToday"] = float64(10)
			f.values["adsBlockedToday"] = float64(2)
			f.values["adsBlockedTodayPercentage"] = float64(20)
			f.values["domainsBeingBlocked"] = float64(100)
		}, false},
		{"negative first sample", func(f *statsFixture) { f.values["dnsQueriesToday"] = float64(-1) }, true},
		{"fractional count", func(f *statsFixture) { f.values["domainsBeingBlocked"] = float64(0.5) }, true},
		{"invalid percentage", func(f *statsFixture) { f.values["adsBlockedTodayPercentage"] = float64(101) }, true},
		{"blocked exceeds queries", func(f *statsFixture) { f.values["adsBlockedToday"] = float64(1) }, true},
		{"wrong unit", func(f *statsFixture) { f.metrics[0].(map[string]any)["unit"] = "bytes" }, true},
		{"missing field", func(f *statsFixture) { delete(f.values, "domainsBeingBlocked") }, true},
		{"null field", func(f *statsFixture) { f.values["adsBlockedTodayPercentage"] = nil }, true},
		{"timestamp predates attempt", func(f *statsFixture) { f.timestamp = 500 }, true},
		{"no-op", func(f *statsFixture) { f.advance = false }, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stats := piholeStatsFixture()
			scenario.change(stats)
			summary := map[string]any{"dnsQueriesToday": float64(0), "adsBlockedToday": float64(0), "adsBlockedTodayPercentage": float64(0), "domainsBeingBlocked": float64(0), "status": "disabled"}
			from, to := piholeVerifyFixture(t, stats, summary, false)
			err := piholeTarget().verifyData(t.Context(), from, to, "pihole-owned")
			if (err != nil) != scenario.fail {
				t.Fatalf("verifyData = %v, failure wanted %v", err, scenario.fail)
			}
			if stats.refreshes != 1 || stats.catalogs != 1 || !stats.force {
				t.Fatalf("Stats requests: refresh=%d catalog=%d force=%v", stats.refreshes, stats.catalogs, stats.force)
			}
		})
	}
}

func TestPiholeVerifyDataKeepsNativeScopeAndSummaryChecks(t *testing.T) {
	for _, scenario := range []struct {
		name           string
		sudo           bool
		invalidSummary bool
	}{
		{name: "privileged application password", sudo: true},
		{name: "missing native field", invalidSummary: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stats := piholeStatsFixture()
			summary := map[string]any{"dnsQueriesToday": float64(0), "adsBlockedToday": float64(0), "adsBlockedTodayPercentage": float64(0), "domainsBeingBlocked": float64(0), "status": "enabled"}
			if scenario.invalidSummary {
				delete(summary, "dnsQueriesToday")
			}
			from, to := piholeVerifyFixture(t, stats, summary, scenario.sudo)
			err := piholeTarget().verifyData(t.Context(), from, to, "pihole-owned")
			if err == nil {
				t.Fatal("invalid native data accepted")
			}
			if scenario.sudo && !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("scope prerequisite must remain Manual: %v", err)
			}
			if stats.catalogs != 0 || stats.refreshes != 0 {
				t.Fatal("native failure reached Stats acquisition")
			}
		})
	}
}
