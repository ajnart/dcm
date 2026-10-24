package homarr

import (
	"context"
	"encoding/json"
	"errors"
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
	f.summary["domainsBeingBlocked"] = 0
	f.values["domainsBeingBlocked"] = 0
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
	for _, scenario := range []struct {
		name          string
		response      string
		version       string
		rejectVersion bool
		valid         bool
		versionReads  int
		failure       string
	}{
		{"null on old schema", `{"filters":null}`, "2.4.1", false, false, 1, ""},
		{"null on fixed 2.5.1", `{"filters":null}`, "2.5.1", false, true, 1, ""},
		{"null on fixed 2.5.2", `{"filters":null}`, "2.5.2", false, true, 1, ""},
		{"null on unreviewed 2.5.0", `{"filters":null}`, "2.5.0", false, false, 1, ""},
		{"null without version", `{"filters":null}`, "", false, false, 1, ""},
		{"null with rejected version auth", `{"filters":null}`, "2.5.2", true, false, 1, ""},
		{"poisoned RPC version failure", `{"filters":null}`, "2.5.2", false, false, 1, "rpc"},
		{"poisoned HTTP version failure", `{"filters":null}`, "2.5.2", false, false, 1, "http"},
		{"empty list on old schema", `{"filters":[]}`, "2.4.1", false, true, 0, ""},
		{"empty list on fixed schema", `{"filters":[]}`, "2.5.2", false, true, 0, ""},
		{"missing filters", `{}`, "2.5.2", false, false, 0, ""},
		{"scalar filters", `{"filters":0}`, "2.5.2", false, false, 0, ""},
		{"object filters", `{"filters":{}}`, "2.5.2", false, false, 0, ""},
		{"text null", `{"filters":"null"}`, "2.5.2", false, false, 0, ""},
		{"valid filter", `{"filters":[{"url":"https://example.invalid/filter","name":"fixture","id":1,"rules_count":2,"enabled":true}]}`, "2.4.1", false, true, 0, ""},
		{"missing metadata", `{"filters":[{"enabled":true,"rules_count":2}]}`, "2.5.2", false, false, 0, ""},
		{"null entry", `{"filters":[null]}`, "2.5.2", false, false, 0, ""},
		{"fractional count", `{"filters":[{"url":"https://example.invalid/filter","name":"fixture","id":1,"rules_count":0.5,"enabled":true}]}`, "2.5.2", false, false, 0, ""},
		{"negative count", `{"filters":[{"url":"https://example.invalid/filter","name":"fixture","id":1,"rules_count":-1,"enabled":true}]}`, "2.5.2", false, false, 0, ""},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			versionReads, writes := 0, 0
			const poisonMarker = "fixture-upstream-private-marker"
			var progress []events.Event
			log := events.New(events.SinkFunc(func(event events.Event) { progress = append(progress, event) }))
			homarr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					writes++
					w.WriteHeader(http.StatusMethodNotAllowed)
					return
				}
				if r.URL.Path != "/api/trpc/info.getInfo" {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				versionReads++
				if r.Header.Get("ApiKey") != "fixture-key" || scenario.rejectVersion {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if scenario.failure == "rpc" {
					json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"json": map[string]any{"message": poisonMarker}}})
					return
				}
				if scenario.failure == "http" {
					w.WriteHeader(http.StatusBadGateway)
					json.NewEncoder(w).Encode(map[string]any{"private": poisonMarker})
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": map[string]any{"version": scenario.version}}}})
			}))
			t.Cleanup(homarr.Close)
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: homarr.URL, HTTP: homarr.Client(), Log: log, Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					writes++
					w.WriteHeader(http.StatusMethodNotAllowed)
					return
				}
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
					w.Write([]byte(scenario.response))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			t.Cleanup(srv.Close)
			to := helpers.New(helpers.Config{App: "adguard-home", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(), Secrets: statsSecrets{"ADMIN_USER": "admin", "ADMIN_PASSWORD": "fixture-password"}})
			if scenario.response == `{"filters":null}` {
				if err := (adguard.App{}).Check(t.Context(), to); err != nil {
					t.Fatalf("valid direct AdGuard null filters: %v", err)
				}
			}
			var err error
			if scenario.failure != "" {
				err = from.Step(t.Context(), "adguard-preflight", "verify AdGuard compatibility", helpers.StepSpec{
					Do:   func(ctx context.Context) error { return adguardTarget().preflight(ctx, from, to) },
					Hint: "preserve DNS settings and retry self-host setup homarr",
				})
				if err == nil || strings.Contains(err.Error(), poisonMarker) || !errors.Is(err, helpers.ErrStepFailed) || errors.Is(err, helpers.ErrManual) {
					t.Fatal("version failure leaked upstream details or lost failure classification")
				}
				rawProgress, encodeErr := json.Marshal(progress)
				if encodeErr != nil || len(progress) == 0 || strings.Contains(string(rawProgress), poisonMarker) {
					t.Fatal("version failure leaked upstream details into progress")
				}
			} else {
				err = adguardTarget().preflight(t.Context(), from, to)
			}
			if (err == nil) != scenario.valid {
				t.Fatal("native preflight returned an unexpected outcome")
			}
			if versionReads != scenario.versionReads || writes != 0 {
				t.Fatalf("version reads=%d want=%d writes=%d", versionReads, scenario.versionReads, writes)
			}
		})
	}
}
