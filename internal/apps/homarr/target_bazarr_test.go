package homarr

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type bazarrTestSecrets map[string]string

func (s bazarrTestSecrets) Get(key string) string       { return s[key] }
func (s bazarrTestSecrets) Set(key, value string) error { s[key] = value; return nil }

func TestBazarrDescriptorUsesNativeWidgetAndSupportedStats(t *testing.T) {
	target := bazarrTarget()
	to := helpers.New(helpers.Config{App: "bazarr", Secrets: bazarrTestSecrets{"BAZARR_API_KEY": "bazarr-test-key"}, Log: events.Discard()})
	if target.id != "bazarr" || target.name != "Bazarr" || target.kind != "bazarr" || target.internal(to) != "http://bazarr:6767" {
		t.Fatal("descriptor does not use Bazarr's native kind and internal Address")
	}
	if !reflect.DeepEqual(target.secrets(nil, to), []secret{{Kind: "apiKey", Value: "bazarr-test-key"}}) {
		t.Fatal("descriptor did not resolve the credential owned by Bazarr Setup")
	}
	if len(target.widgets) != 2 || target.widgets[0].kind != "bazarr" || target.widgets[1].kind != "stats" {
		t.Fatal("descriptor must provide the native Bazarr widget and shared Stats")
	}
	if !reflect.DeepEqual(target.widgets[0].options, map[string]any{
		"showMissingEpisodes": true, "showMissingMovies": true, "showProviderIssues": true, "showHealthIssues": true,
	}) || !reflect.DeepEqual(target.widgets[1].metrics, []string{"episodes", "movies", "providers"}) {
		t.Fatal("descriptor options or Stats metrics do not match Homarr 2.4.1")
	}
	if target.verify == nil {
		t.Fatal("descriptor must verify meaningful authenticated widget data")
	}
}

func TestBazarrVerificationRequiresNativeAndHomarrData(t *testing.T) {
	valid := map[string]any{
		"episodes": 4, "movies": 2, "providers": 1, "status": 1,
		"sonarr_signalr": "LIVE", "radarr_signalr": "DOWN", "announcements": 0,
	}
	for _, tc := range []struct {
		name         string
		omit         string
		change       string
		value        any
		nativeStatus int
		homarrStatus int
		empty        bool
		wantError    bool
	}{
		{name: "populated"},
		{name: "empty library", empty: true},
		{name: "missing subtitle count", omit: "episodes", wantError: true},
		{name: "null subtitle count", change: "movies", wantError: true},
		{name: "negative count", change: "episodes", value: -1, wantError: true},
		{name: "fractional count", change: "episodes", value: 0.5, wantError: true},
		{name: "missing connection status", omit: "sonarr_signalr", wantError: true},
		{name: "wrong connection status", change: "radarr_signalr", value: false, wantError: true},
		{name: "native key rejected", nativeStatus: http.StatusUnauthorized, wantError: true},
		{name: "Homarr denied", homarrStatus: http.StatusForbidden, wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			badges := make(map[string]any, len(valid))
			for key, value := range valid {
				badges[key] = value
			}
			if tc.empty {
				for _, key := range []string{"episodes", "movies", "providers", "status", "announcements"} {
					badges[key] = 0
				}
				badges["sonarr_signalr"], badges["radarr_signalr"] = "DOWN", "DOWN"
			}
			delete(badges, tc.omit)
			if tc.change != "" {
				badges[tc.change] = tc.value
			}
			native := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-API-KEY") != "bazarr-test-key" {
					t.Error("native request did not authenticate with Bazarr's saved key")
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				if tc.nativeStatus != 0 {
					w.WriteHeader(tc.nativeStatus)
					return
				}
				if r.URL.Path == "/api/system/status" {
					w.Write([]byte(`{"data":{"bazarr_version":"1.6.0"}}`))
					return
				}
				if r.URL.Path != "/api/badges" {
					t.Error("unexpected native API path")
				}
				json.NewEncoder(w).Encode(valid)
			}))
			t.Cleanup(native.Close)
			homarrRequests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				homarrRequests++
				if r.Header.Get("ApiKey") != "homarr-test-key" || r.URL.Path != "/api/trpc/widget.bazarr.getBadges" {
					t.Error("widget request did not use Homarr's authenticated native query")
				}
				var input struct {
					JSON struct {
						IntegrationID string `json:"integrationId"`
					} `json:"json"`
				}
				if err := json.Unmarshal([]byte(r.URL.Query().Get("input")), &input); err != nil || input.JSON.IntegrationID != "owned-bazarr-integration" {
					t.Error("widget request did not use the returned integration ID")
				}
				if tc.homarrStatus != 0 {
					w.WriteHeader(tc.homarrStatus)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": badges}}})
			}))
			t.Cleanup(server.Close)
			from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, Secrets: bazarrTestSecrets{"HOMARR_API_KEY": "homarr-test-key"}, Log: events.Discard()})
			to := helpers.New(helpers.Config{App: "bazarr", BaseURL: native.URL, Secrets: bazarrTestSecrets{"BAZARR_API_KEY": "bazarr-test-key"}, Log: events.Discard()})
			err := bazarrTarget().verify(context.Background(), from, to, "owned-bazarr-integration")
			if (err != nil) != tc.wantError {
				t.Fatalf("verification error = %v, want error %v", err, tc.wantError)
			}
			if tc.nativeStatus != 0 && homarrRequests != 0 {
				t.Fatal("rejected native credential still attempted Homarr")
			}
		})
	}
}
