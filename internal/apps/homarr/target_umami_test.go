package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type umamiDescriptorFixture struct {
	stats       *statsFixture
	native      map[string]any
	websites    []any
	active      any
	peerReject  bool
	nativeReads int
	wrongInput  bool
}

func newUmamiDescriptorFixture() *umamiDescriptorFixture {
	stats := newStatsFixture()
	stats.metrics = []any{map[string]any{"key": "websites", "unit": "count"}}
	stats.values = map[string]any{"websites": float64(1)}
	return &umamiDescriptorFixture{
		stats: stats, active: float64(0),
		websites: []any{map[string]any{"id": "fixture-site", "name": "self-host Homarr fixture", "domain": "self-host.invalid"}},
		native: map[string]any{
			"integrationId": "umami-owned", "updatedAt": "2026-10-13T12:00:00Z",
			"visitorStats": map[string]any{
				"websiteId": "fixture-site", "websiteName": "self-host Homarr fixture", "domain": "self-host.invalid", "timeFrame": "24h",
				"totalVisitors": float64(0), "totalPageviews": float64(0), "totalVisits": float64(0),
				"bounceRate": float64(0), "avgDuration": float64(0), "dataPoints": []any{},
			},
		},
	}
}

func (f *umamiDescriptorFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/trpc/widget.stats.") {
		f.stats.ServeHTTP(w, r)
		return
	}
	if r.Header.Get("ApiKey") != "fixture-key" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var input struct {
		JSON map[string]any `json:"json"`
	}
	if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil {
		f.wrongInput = true
	}
	var value any
	f.nativeReads++
	switch r.URL.Path {
	case "/api/trpc/widget.umami.getWebsites":
		f.wrongInput = f.wrongInput || input.JSON["integrationId"] != "umami-owned"
		value = f.websites
	case "/api/trpc/widget.umami.getVisitorStats":
		ids, ok := input.JSON["integrationIds"].([]any)
		f.wrongInput = f.wrongInput || !ok || len(ids) != 1 || ids[0] != "umami-owned" || input.JSON["websiteId"] != "fixture-site" || input.JSON["timeFrame"] != "24h"
		value = []any{f.native}
	case "/api/trpc/widget.umami.getActiveVisitors":
		f.wrongInput = f.wrongInput || input.JSON["integrationId"] != "umami-owned" || input.JSON["websiteId"] != "fixture-site"
		value = f.active
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
}

func (f *umamiDescriptorFixture) helpers(t *testing.T) (*helpers.H, *helpers.H) {
	t.Helper()
	homarr := httptest.NewServer(f)
	t.Cleanup(homarr.Close)
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if f.peerReject {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var value any
		if r.URL.Path == "/api/auth/login" {
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			if input["username"] != "self-host-homarr" || input["password"] != "fixture-password" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			value = map[string]any{"token": "fixture-token", "user": map[string]any{"id": "fixture-user", "username": "self-host-homarr", "role": "view-only", "isAdmin": false, "teams": []any{}}}
		} else {
			if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer fixture-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			switch r.URL.Path {
			case "/api/websites/fixture-site":
				value = map[string]any{"id": "fixture-site", "name": "self-host Homarr fixture", "domain": "self-host.invalid", "userId": "fixture-user", "createdBy": "fixture-admin", "teamId": nil, "shareId": nil, "recorderEnabled": false}
			case "/api/websites/fixture-site/stats":
				value = map[string]any{"pageviews": 0, "visitors": 0, "visits": 0, "bounces": 0, "totaltime": 0}
			case "/api/websites/fixture-site/pageviews":
				value = map[string]any{"pageviews": []any{}, "sessions": []any{}}
			case "/api/websites/fixture-site/active":
				value = map[string]any{"visitors": 0}
			default:
				w.WriteHeader(http.StatusNotFound)
				return
			}
		}
		json.NewEncoder(w).Encode(value)
	}))
	t.Cleanup(peer.Close)
	now := func() time.Time { return time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC) }
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: homarr.URL, HTTP: homarr.Client(), Log: events.Discard(), Now: now,
		Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"},
	})
	to := helpers.New(helpers.Config{App: "umami", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(), Now: now,
		Secrets: statsSecrets{
			"UMAMI_HOMARR_USER_ID": "fixture-user", "UMAMI_HOMARR_USERNAME": "self-host-homarr", "UMAMI_HOMARR_PASSWORD": "fixture-password",
			"UMAMI_HOMARR_WEBSITE_ID": "fixture-site", "UMAMI_HOMARR_WEBSITE_CREATED_BY": "fixture-admin",
		},
	})
	return from, to
}

func TestUmamiDescriptorUsesOneStatsRefreshWithNativeAnalytics(t *testing.T) {
	for _, timestamp := range []string{"", "2026-10-13 12:00:00", "2026-10-13T12:00:00Z"} {
		t.Run("series "+timestamp, func(t *testing.T) {
			f := newUmamiDescriptorFixture()
			if timestamp != "" {
				f.native["visitorStats"].(map[string]any)["dataPoints"] = []any{map[string]any{"visitors": 0, "timestamp": timestamp}}
			}
			// Website membership can change between independent native and Stats reads.
			f.stats.values["websites"] = float64(2)
			from, to := f.helpers(t)
			if err := umamiTarget().verifyData(t.Context(), from, to, "umami-owned"); err != nil {
				t.Fatal(err)
			}
			if f.wrongInput || f.nativeReads != 3 || f.stats.catalogs != 1 || f.stats.snapshots != 1 || f.stats.refreshes != 1 || !f.stats.force || f.stats.integrationID != "umami-owned" {
				t.Fatalf("unexpected requests: native=%d catalog=%d snapshots=%d refreshes=%d force=%v id=%s wrongInput=%v", f.nativeReads, f.stats.catalogs, f.stats.snapshots, f.stats.refreshes, f.stats.force, f.stats.integrationID, f.wrongInput)
			}
		})
	}
}

func TestUmamiDescriptorRejectsInvalidStatsSample(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(*statsFixture)
		refreshes int
		valid     bool
	}{
		{"zero websites", func(f *statsFixture) { f.values["websites"] = float64(0) }, 1, true},
		{"negative", func(f *statsFixture) { f.values["websites"] = float64(-1) }, 1, false},
		{"fractional", func(f *statsFixture) { f.values["websites"] = 1.5 }, 1, false},
		{"null", func(f *statsFixture) { f.values["websites"] = nil }, 1, false},
		{"missing", func(f *statsFixture) { delete(f.values, "websites") }, 1, false},
		{"wrong unit", func(f *statsFixture) { f.metrics = []any{map[string]any{"key": "websites", "unit": "bytes"}} }, 1, false},
		{"unavailable metric", func(f *statsFixture) { f.metrics = []any{} }, 0, false},
		{"no-op", func(f *statsFixture) { f.advance = false }, 1, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newUmamiDescriptorFixture()
			scenario.change(f.stats)
			from, to := f.helpers(t)
			if err := umamiTarget().verifyData(t.Context(), from, to, "umami-owned"); (err == nil) != scenario.valid {
				t.Fatalf("valid=%v: %v", scenario.valid, err)
			}
			if f.stats.refreshes != scenario.refreshes || f.wrongInput {
				t.Fatalf("unexpected refreshes=%d wrongInput=%v", f.stats.refreshes, f.wrongInput)
			}
		})
	}
}

func TestUmamiDescriptorStopsBeforeStatsOnNativeFailure(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*umamiDescriptorFixture)
	}{
		{"peer auth", func(f *umamiDescriptorFixture) { f.peerReject = true }},
		{"website identity", func(f *umamiDescriptorFixture) { f.websites[0].(map[string]any)["id"] = "other-site" }},
		{"window", func(f *umamiDescriptorFixture) { f.native["visitorStats"].(map[string]any)["timeFrame"] = "7d" }},
		{"domain", func(f *umamiDescriptorFixture) { f.native["visitorStats"].(map[string]any)["domain"] = "other.invalid" }},
		{"body error", func(f *umamiDescriptorFixture) { f.native["error"] = "fixture-error" }},
		{"stale timestamp", func(f *umamiDescriptorFixture) { f.native["updatedAt"] = "2026-10-13T11:58:00Z" }},
		{"future timestamp", func(f *umamiDescriptorFixture) { f.native["updatedAt"] = "2026-10-13T12:02:00Z" }},
		{"missing visitors", func(f *umamiDescriptorFixture) { delete(f.native["visitorStats"].(map[string]any), "totalVisitors") }},
		{"fractional count", func(f *umamiDescriptorFixture) { f.native["visitorStats"].(map[string]any)["totalVisits"] = 1.5 }},
		{"bounce range", func(f *umamiDescriptorFixture) {
			f.native["visitorStats"].(map[string]any)["bounceRate"] = float64(101)
		}},
		{"missing series", func(f *umamiDescriptorFixture) { f.native["visitorStats"].(map[string]any)["dataPoints"] = nil }},
		{"invalid point", func(f *umamiDescriptorFixture) {
			f.native["visitorStats"].(map[string]any)["dataPoints"] = []any{map[string]any{"visitors": 0, "timestamp": "invalid"}}
		}},
		{"active missing", func(f *umamiDescriptorFixture) { f.active = nil }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newUmamiDescriptorFixture()
			scenario.change(f)
			from, to := f.helpers(t)
			if err := umamiTarget().verifyData(t.Context(), from, to, "umami-owned"); err == nil {
				t.Fatal("invalid native response completed verification")
			}
			if f.stats.catalogs != 0 || f.stats.snapshots != 0 || f.stats.refreshes != 0 {
				t.Fatalf("native failure acquired Stats: %+v", f.stats)
			}
		})
	}
}
