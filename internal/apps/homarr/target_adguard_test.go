package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/adguard"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type adguardVerificationFixture struct {
	summary     map[string]any
	values      map[string]any
	units       map[string]string
	ownedID     string
	advance     bool
	reject      bool
	timestamp   int
	refreshes   int
	catalogs    int
	nativeReads int
}

func newAdguardVerificationFixture() *adguardVerificationFixture {
	return &adguardVerificationFixture{
		summary: map[string]any{"status": "enabled", "dnsQueriesToday": 0, "adsBlockedToday": 0, "domainsBeingBlocked": 2, "adsBlockedTodayPercentage": 0},
		values:  map[string]any{"dnsQueriesToday": 0, "adsBlockedToday": 0, "domainsBeingBlocked": 2},
		units:   map[string]string{"dnsQueriesToday": "count", "adsBlockedToday": "count", "domainsBeingBlocked": "count"},
		ownedID: "adguard-owned", advance: true, timestamp: 1000,
	}
}

func (f *adguardVerificationFixture) helper(t *testing.T) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("ApiKey") != "fixture-key" || f.reject {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var value any
		switch r.URL.Path {
		case "/api/trpc/widget.dnsHole.summary":
			f.nativeReads++
			value = []any{map[string]any{"integrationId": f.ownedID, "integration": map[string]any{"id": f.ownedID, "kind": "adGuardHome"}, "summary": f.summary}}
		case "/api/trpc/widget.stats.catalog":
			f.catalogs++
			metrics := []any{}
			for key, unit := range f.units {
				metrics = append(metrics, map[string]any{"key": key, "unit": unit})
			}
			value = map[string]any{"metrics": metrics}
		case "/api/trpc/widget.stats.snapshot":
			value = map[string]any{"updatedAt": f.timestamp}
		case "/api/trpc/widget.stats.refresh":
			var input struct {
				JSON map[string]any `json:"json"`
			}
			json.NewDecoder(r.Body).Decode(&input)
			if input.JSON["force"] != true || input.JSON["integrationId"] != "adguard-owned" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			f.refreshes++
			if f.advance {
				f.timestamp++
			}
			value = map[string]any{"updatedAt": f.timestamp, "stale": false, "error": false, "values": f.values}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "homarr", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key", "HOMARR_LINKED_ADGUARD_HOME": "adguard-owned"}})
}

func TestAdguardVerificationAcceptsZeroAndUsesOneFreshStatsSample(t *testing.T) {
	f := newAdguardVerificationFixture()
	h := f.helper(t)
	if err := adguardTarget().verifyData(t.Context(), h, h, "adguard-owned"); err != nil {
		t.Fatal(err)
	}
	if f.refreshes != 1 || f.catalogs != 1 || f.nativeReads != 1 {
		t.Fatalf("refreshes=%d catalogs=%d native=%d", f.refreshes, f.catalogs, f.nativeReads)
	}
	f.advance = false
	if err := adguardTarget().verifyData(t.Context(), h, h, "adguard-owned"); err == nil {
		t.Fatal("accepted no-op refresh")
	}
	f.advance = true
	f.reject = true
	if err := adguardTarget().verifyData(t.Context(), h, h, "adguard-owned"); err == nil {
		t.Fatal("accepted rejected authentication")
	}
	f.reject = false
	if err := adguardTarget().verifyData(t.Context(), h, h, "adguard-owned"); err != nil {
		t.Fatal(err)
	}
}

func TestAdguardVerificationRejectsInvalidNativeAndStatsData(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*adguardVerificationFixture)
	}{
		{"null summary", func(f *adguardVerificationFixture) { f.summary = nil }},
		{"wrong integration", func(f *adguardVerificationFixture) { f.ownedID = "user-owned" }},
		{"missing native count", func(f *adguardVerificationFixture) { delete(f.summary, "dnsQueriesToday") }},
		{"null native count", func(f *adguardVerificationFixture) { f.summary["dnsQueriesToday"] = nil }},
		{"fractional native count", func(f *adguardVerificationFixture) { f.summary["dnsQueriesToday"] = 0.5 }},
		{"negative native count", func(f *adguardVerificationFixture) { f.summary["dnsQueriesToday"] = -1 }},
		{"blocked exceeds native queries", func(f *adguardVerificationFixture) { f.summary["adsBlockedToday"] = 1 }},
		{"missing percentage", func(f *adguardVerificationFixture) { delete(f.summary, "adsBlockedTodayPercentage") }},
		{"null percentage", func(f *adguardVerificationFixture) { f.summary["adsBlockedTodayPercentage"] = nil }},
		{"reversed upstream percentage", func(f *adguardVerificationFixture) {
			f.summary["dnsQueriesToday"] = 4
			f.summary["adsBlockedToday"] = 2
			f.summary["adsBlockedTodayPercentage"] = 200
		}},
		{"wrong in-range percentage", func(f *adguardVerificationFixture) {
			f.summary["dnsQueriesToday"] = 4
			f.summary["adsBlockedToday"] = 2
			f.summary["adsBlockedTodayPercentage"] = 25
		}},
		{"missing Stats count", func(f *adguardVerificationFixture) { delete(f.values, "dnsQueriesToday") }},
		{"null Stats count", func(f *adguardVerificationFixture) { f.values["dnsQueriesToday"] = nil }},
		{"fractional Stats count", func(f *adguardVerificationFixture) { f.values["dnsQueriesToday"] = 0.5 }},
		{"negative Stats count", func(f *adguardVerificationFixture) { f.values["dnsQueriesToday"] = -1 }},
		{"blocked exceeds Stats queries", func(f *adguardVerificationFixture) { f.values["adsBlockedToday"] = 1 }},
		{"wrong unit", func(f *adguardVerificationFixture) { f.units["dnsQueriesToday"] = "percent" }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newAdguardVerificationFixture()
			scenario.change(f)
			h := f.helper(t)
			if err := adguardTarget().verifyData(t.Context(), h, h, "adguard-owned"); err == nil {
				t.Fatal("accepted invalid data")
			}
			if f.refreshes > 1 {
				t.Fatalf("semantic rejection acquired %d samples", f.refreshes)
			}
		})
	}
}

func TestAdguardNativeAndStatsSamplesRemainIndependent(t *testing.T) {
	f := newAdguardVerificationFixture()
	f.summary["dnsQueriesToday"] = 4
	f.summary["adsBlockedToday"] = 2
	f.summary["adsBlockedTodayPercentage"] = 50
	f.values["dnsQueriesToday"] = 5
	f.values["adsBlockedToday"] = 3
	h := f.helper(t)
	if err := adguardTarget().verifyData(t.Context(), h, h, "adguard-owned"); err != nil {
		t.Fatal(err)
	}
}

func TestAdguardPreflightDistinguishesNullAndMissingFilters(t *testing.T) {
	for _, response := range []string{`{"filters":null}`, `{"filters":[]}`, `{}`, `{"filters":[{"url":"https://example.invalid/filter","name":"fixture","id":1,"rules_count":2,"enabled":true}]}`, `{"filters":[{"enabled":true,"rules_count":2}]}`} {
		t.Run(response, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if user, password, ok := r.BasicAuth(); !ok || user != "admin" || password != "fixture-password" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/control/profile":
					w.Write([]byte(`{"name":"admin"}`))
				case "/control/status":
					w.Write([]byte(`{"version":"v0.107.79","running":true,"dns_port":53,"http_port":3000}`))
				case "/control/stats":
					w.Write([]byte(`{"time_units":"hours","dns_queries":[],"blocked_filtering":[],"num_dns_queries":0,"num_blocked_filtering":0}`))
				case "/control/filtering/status":
					w.Write([]byte(response))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			t.Cleanup(srv.Close)
			h := helpers.New(helpers.Config{App: "adguard-home", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-password"}})
			err := adguardTarget().preflight(t.Context(), h, h)
			switch response {
			case `{"filters":null}`:
				if check := (adguard.App{}).Check(t.Context(), h); check != nil {
					t.Fatalf("valid AdGuard null filters: %v", check)
				}
				if err == nil || !strings.Contains(err.Error(), "valid null filters") {
					t.Fatalf("missing native compatibility diagnostic: %v", err)
				}
			case `{"filters":[]}`, `{"filters":[{"url":"https://example.invalid/filter","name":"fixture","id":1,"rules_count":2,"enabled":true}]}`:
				if err != nil {
					t.Fatal(err)
				}
			default:
				if err == nil {
					t.Fatal("accepted missing filter data or native metadata")
				}
			}
		})
	}
}
