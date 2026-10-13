package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestTechnitiumDNSLinkUsesOneStatsSampleAfterReadOnlyLastHourCheck(t *testing.T) {
	for _, scenario := range []struct {
		name       string
		queries    float64
		blocked    float64
		percentage float64
		wrongUnit  bool
		noOp       bool
		old        bool
		excessive  bool
		wantErr    bool
	}{
		{name: "explicit zero"},
		{name: "fractional count", queries: 0.5, wantErr: true},
		{name: "negative count", blocked: -1, wantErr: true},
		{name: "blocked exceeds queries", queries: 1, blocked: 2, wantErr: true},
		{name: "percentage exceeds 100", percentage: 101, wantErr: true},
		{name: "wrong unit", wrongUnit: true, wantErr: true},
		{name: "no-op refresh", noOp: true, wantErr: true},
		{name: "advancing before attempt", old: true, wantErr: true},
		{name: "excessive token permissions", excessive: true, wantErr: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newStatsFixture()
			fixture.advance = !scenario.noOp
			fixture.values = map[string]any{
				"dnsQueriesToday": scenario.queries, "adsBlockedToday": scenario.blocked,
				"adsBlockedTodayPercentage": scenario.percentage, "domainsBeingBlocked": float64(0),
			}
			fixture.metrics = []any{}
			for key, unit := range map[string]string{"dnsQueriesToday": "count", "adsBlockedToday": "count", "adsBlockedTodayPercentage": "percent", "domainsBeingBlocked": "count"} {
				if scenario.wrongUnit && key == "dnsQueriesToday" {
					unit = "bytes"
				}
				fixture.metrics = append(fixture.metrics, map[string]any{"key": key, "unit": unit})
			}
			from := fixture.helpers(t)
			from.Now = func() time.Time { return time.UnixMilli(1000) }
			if scenario.old {
				from.Now = func() time.Time { return time.UnixMilli(2000) }
			}
			lastHourReads := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-token" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				var value any
				switch r.URL.Path {
				case "/api/user/session/get":
					permissions := map[string]any{}
					for _, section := range []string{"Dashboard", "Zones", "Cache", "Allowed", "Blocked", "Apps", "DnsClient", "Settings", "DhcpServer", "Administration", "Logs"} {
						permissions[section] = map[string]bool{"canView": section != "Settings" && section != "Administration", "canModify": scenario.excessive, "canDelete": false}
					}
					value = map[string]any{
						"status": "ok", "username": "self-host-homarr", "tokenName": "self-host Homarr statistics", "token": "fixture-token",
						"info": map[string]any{"version": "15.5.1", "permissions": permissions},
					}
				case "/api/dashboard/stats/get":
					lastHourReads++
					if r.URL.Query().Get("type") != "LastHour" {
						t.Error("native DNS statistics did not select LastHour")
					}
					// Native and Homarr values are independent volatile samples.
					value = map[string]any{"status": "ok", "response": map[string]any{"stats": map[string]int{"totalQueries": 17, "totalBlocked": 3, "blockedZones": 1, "blockListZones": 2}}}
				default:
					t.Errorf("unexpected native path %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
					return
				}
				json.NewEncoder(w).Encode(value)
			}))
			t.Cleanup(srv.Close)
			to := helpers.New(helpers.Config{
				App: "technitium-dns", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard(),
				Secrets: statsSecrets{"TECHNITIUM_DNS_HOMARR_API_KEY": "fixture-token", "TECHNITIUM_DNS_HOMARR_USER": "self-host-homarr"},
			})
			err := technitiumDNSTarget().verifyData(t.Context(), from, to, "technitium-owned")
			if (err != nil) != scenario.wantErr {
				t.Fatalf("verification error = %v, want error %v", err, scenario.wantErr)
			}
			if scenario.excessive {
				if fixture.catalogs != 0 || fixture.refreshes != 0 || lastHourReads != 0 {
					t.Fatalf("permission failure reached native statistics/Stats: %d/%d/%d", lastHourReads, fixture.catalogs, fixture.refreshes)
				}
			} else if lastHourReads != 1 || fixture.catalogs != 1 || fixture.refreshes != 1 || !fixture.force {
				t.Fatalf("expected native LastHour and one forced Stats sample: %d/%d/%d force=%v", lastHourReads, fixture.catalogs, fixture.refreshes, fixture.force)
			}
		})
	}
}
