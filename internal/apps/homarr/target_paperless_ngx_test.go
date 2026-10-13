package homarr

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func paperlessFixtureValues() map[string]any {
	return map[string]any{
		"documentsTotal": float64(3), "documentsInbox": float64(1),
		"tagsCount": float64(2), "correspondentsCount": float64(4), "documentTypesCount": float64(1),
	}
}

func TestPaperlessVerifiesNativeAndOneStatsSample(t *testing.T) {
	for _, tc := range []struct {
		name         string
		change       func(map[string]any, map[string]any, map[string]any)
		nativeStatus int
		noRefresh    bool
		wantError    bool
	}{
		{name: "authenticated counts"},
		{name: "independently cached counts", change: func(_, native, stats map[string]any) {
			native["documentsTotal"] = float64(2)
			stats["documentsTotal"] = float64(4)
		}},
		{name: "inbox exceeds total", wantError: true, change: func(_, native, _ map[string]any) { native["documentsInbox"] = float64(4) }},
		{name: "missing native taxonomy", wantError: true, change: func(_, native, _ map[string]any) { delete(native, "tagsCount") }},
		{name: "null native taxonomy", wantError: true, change: func(_, native, _ map[string]any) { native["tagsCount"] = nil }},
		{name: "null native inbox", wantError: true, change: func(_, native, _ map[string]any) { native["documentsInbox"] = nil }},
		{name: "native authentication rejected", nativeStatus: http.StatusUnauthorized, wantError: true},
		{name: "Stats refresh does not advance", noRefresh: true, wantError: true},
		{name: "invalid first Stats sample", wantError: true, change: func(_, _, stats map[string]any) { stats["tagsCount"] = float64(-1) }},
		{name: "missing Stats count", wantError: true, change: func(_, _, stats map[string]any) { delete(stats, "tagsCount") }},
		{name: "null Stats count", wantError: true, change: func(_, _, stats map[string]any) { stats["tagsCount"] = nil }},
		{name: "Stats inbox exceeds total", wantError: true, change: func(_, _, stats map[string]any) { stats["documentsInbox"] = float64(4) }},
		{name: "no inbox configured", change: func(source, native, stats map[string]any) {
			source["documents_inbox"], source["inbox_tag"], source["inbox_tags"] = nil, nil, nil
			native["documentsInbox"], stats["documentsInbox"] = float64(0), float64(0)
		}},
		{name: "unexplained null inbox", wantError: true, change: func(source, _, _ map[string]any) { source["documents_inbox"] = nil }},
		{name: "missing inbox", wantError: true, change: func(source, _, _ map[string]any) { delete(source, "documents_inbox") }},
		{name: "missing no inbox metadata", wantError: true, change: func(source, _, _ map[string]any) {
			source["documents_inbox"], source["inbox_tag"] = nil, nil
			delete(source, "inbox_tags")
		}},
		{name: "missing source documents", wantError: true, change: func(source, _, _ map[string]any) { delete(source, "documents_total") }},
		{name: "explicit empty documents", change: func(source, native, stats map[string]any) {
			source["documents_total"], source["documents_inbox"] = 0, 0
			native["documentsTotal"], native["documentsInbox"] = float64(0), float64(0)
			stats["documentsTotal"], stats["documentsInbox"] = float64(0), float64(0)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := map[string]any{"documents_total": 3, "documents_inbox": 1, "inbox_tag": 7, "inbox_tags": []int{7}}
			native, stats := paperlessFixtureValues(), paperlessFixtureValues()
			if tc.change != nil {
				tc.change(source, native, stats)
			}
			peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Token paperless-fixture-key" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				switch r.URL.Path {
				case "/api/statistics/":
					json.NewEncoder(w).Encode(source)
				case "/api/tags/":
					json.NewEncoder(w).Encode(map[string]int{"count": 2})
				case "/api/correspondents/":
					json.NewEncoder(w).Encode(map[string]int{"count": 4})
				case "/api/document_types/":
					json.NewEncoder(w).Encode(map[string]int{"count": 1})
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer peer.Close()
			catalogs, refreshes := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("ApiKey") != "homarr-fixture-key" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
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
				if input.JSON.IntegrationID != "paperless-owned" {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				var value any
				switch r.URL.Path {
				case "/api/trpc/widget.paperlessNgx.getStats":
					if tc.nativeStatus != 0 {
						w.WriteHeader(tc.nativeStatus)
						return
					}
					value = native
				case "/api/trpc/widget.stats.catalog":
					catalogs++
					value = map[string]any{"metrics": []any{
						map[string]string{"key": "documentsTotal", "unit": "count"},
						map[string]string{"key": "documentsInbox", "unit": "count"},
						map[string]string{"key": "tagsCount", "unit": "count"},
						map[string]string{"key": "correspondentsCount", "unit": "count"},
						map[string]string{"key": "documentTypesCount", "unit": "count"},
					}}
				case "/api/trpc/widget.stats.snapshot":
					value = map[string]any{"updatedAt": 1000}
				case "/api/trpc/widget.stats.refresh":
					refreshes++
					if r.Method != http.MethodPost || !input.JSON.Force {
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					updated := 2000
					if tc.noRefresh {
						updated = 1000
					}
					values := stats
					if refreshes > 1 {
						values = paperlessFixtureValues()
					}
					value = map[string]any{"updatedAt": updated, "error": false, "stale": false, "values": values}
				default:
					w.WriteHeader(http.StatusNotFound)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			defer server.Close()
			from := helpers.New(helpers.Config{
				App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(),
				Secrets: statsSecrets{"HOMARR_API_KEY": "homarr-fixture-key"},
			})
			to := helpers.New(helpers.Config{
				App: "paperless-ngx", BaseURL: peer.URL, HTTP: peer.Client(), Log: events.Discard(),
				Secrets: statsSecrets{"PAPERLESS_NGX_API_KEY": "paperless-fixture-key"},
			})
			err := paperlessTarget().verifyData(context.Background(), from, to, "paperless-owned")
			if (err != nil) != tc.wantError {
				t.Fatalf("verification error = %v, want error %v", err, tc.wantError)
			}
			if refreshes > 1 || catalogs > 1 {
				t.Fatalf("verification acquired multiple Stats samples: refreshes=%d catalogs=%d", refreshes, catalogs)
			}
			if !tc.wantError && (refreshes != 1 || catalogs != 1) {
				t.Fatalf("successful verification needs one catalog and refresh: refreshes=%d catalogs=%d", refreshes, catalogs)
			}
		})
	}
}

func TestPaperlessStatsSemantics(t *testing.T) {
	zero := statsSample{
		values: map[string]any{
			"documentsTotal": float64(0), "documentsInbox": float64(0), "tagsCount": float64(0),
			"correspondentsCount": float64(0), "documentTypesCount": float64(0),
		},
		units: map[string]string{
			"documentsTotal": "count", "documentsInbox": "count", "tagsCount": "count",
			"correspondentsCount": "count", "documentTypesCount": "count",
		},
	}
	if err := verifyPaperlessStats(zero); err != nil {
		t.Fatalf("explicit zero counts must remain valid: %v", err)
	}
	for _, metric := range []string{"documentsTotal", "documentsInbox", "tagsCount", "correspondentsCount", "documentTypesCount"} {
		for _, invalid := range []any{nil, "0", float64(-1), float64(0.5), math.NaN(), math.Inf(1)} {
			values := paperlessFixtureValues()
			values[metric] = invalid
			if verifyPaperlessValues(values) == nil {
				t.Fatalf("%s accepted invalid count %v", metric, invalid)
			}
		}
		units := map[string]string{
			"documentsTotal": "count", "documentsInbox": "count", "tagsCount": "count",
			"correspondentsCount": "count", "documentTypesCount": "count",
		}
		units[metric] = "bytes"
		if verifyPaperlessStats(statsSample{values: paperlessFixtureValues(), units: units}) == nil {
			t.Fatalf("%s accepted bytes instead of count", metric)
		}
	}
}
