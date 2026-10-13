package homarr

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type gluetunFixture struct {
	version    string
	unreadable bool
	status     string
	ip         string
	result     any
	paths      []string
	stats      *statsFixture
}

func newGluetunFixture() *gluetunFixture {
	stats := newStatsFixture()
	stats.values = map[string]any{"status": "running", "publicIp": "203.0.113.42"}
	stats.metrics = []any{map[string]any{"key": "status", "unit": "text"}, map[string]any{"key": "publicIp", "unit": "text"}}
	return &gluetunFixture{version: "2.5.2", status: "running", ip: "203.0.113.42", stats: stats,
		result: []any{map[string]any{"integration": map[string]any{"id": "gluetun-owned", "kind": "gluetun"},
			"summary": map[string]any{"vpnStatus": "running", "publicIp": "203.0.113.42"}}},
	}
}

func (f *gluetunFixture) helpers(t *testing.T) (*helpers.H, *helpers.H) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.paths = append(f.paths, r.URL.Path)
		var value any
		switch r.URL.Path {
		case "/api/trpc/info.getInfo":
			if f.unreadable {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			value = map[string]any{"version": f.version}
		case "/api/trpc/widget.vpn.getSummaries":
			var input struct {
				JSON struct {
					IntegrationIDs []string `json:"integrationIds"`
				} `json:"json"`
			}
			if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil || !reflect.DeepEqual(input.JSON.IntegrationIDs, []string{"gluetun-owned"}) {
				t.Error("VPN query must request exactly the owned integration")
			}
			value = f.result
		case "/api/trpc/widget.stats.catalog", "/api/trpc/widget.stats.snapshot", "/api/trpc/widget.stats.refresh":
			f.stats.ServeHTTP(w, r)
			return
		case "/v1/vpn/status", "/v1/publicip/ip":
			if r.Header.Get("X-API-Key") == "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Header.Get("X-API-Key") != "fixture-control-key" {
				t.Error("wrong saved control credential")
			}
			if r.URL.Path == "/v1/vpn/status" {
				json.NewEncoder(w).Encode(map[string]any{"status": f.status})
			} else {
				json.NewEncoder(w).Encode(map[string]any{"public_ip": f.ip})
			}
			return
		default:
			t.Errorf("unexpected/forbidden request: %s", r.URL.Path)
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if r.Header.Get("ApiKey") != "fixture-key" {
			t.Error("Homarr request missing its saved credential")
		}
		json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
	}))
	t.Cleanup(server.Close)
	from := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
	to := helpers.New(helpers.Config{App: "gluetun", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"GLUETUN_CONTROL_API_KEY": "fixture-control-key"}})
	return from, to
}

func TestGluetunUnsafeVersionsHoldBeforeProviderOrMutation(t *testing.T) {
	for _, version := range []string{"2.4.1", "2.5.0", "2.5.3", "", "2.5.2-preview", "unreadable"} {
		t.Run(version, func(t *testing.T) {
			f := newGluetunFixture()
			f.version = version
			f.unreadable = version == "unreadable"
			from, to := f.helpers(t)
			descriptor := gluetunTarget()
			if linked, err := descriptor.linked(t.Context(), from, to); linked || !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("Check: linked=%v err=%v", linked, err)
			}
			if err := descriptor.add(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("apply: %v", err)
			}
			if err := descriptor.verifyData(t.Context(), from, to, "gluetun-owned"); !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("standalone verification: %v", err)
			}
			if !reflect.DeepEqual(f.paths, []string{"/api/trpc/info.getInfo", "/api/trpc/info.getInfo", "/api/trpc/info.getInfo"}) {
				t.Fatalf("unsafe version requests: %v", f.paths)
			}
		})
	}
}

func TestGluetunSafePreflightUsesOnlyRestrictedControlReads(t *testing.T) {
	for _, version := range []string{"2.5.1", "2.5.2"} {
		t.Run(version, func(t *testing.T) {
			f := newGluetunFixture()
			f.version = version
			from, to := f.helpers(t)
			if err := gluetunTarget().preflight(t.Context(), from, to); err != nil {
				t.Fatal(err)
			}
			want := []string{"/api/trpc/info.getInfo", "/v1/vpn/status", "/v1/vpn/status", "/v1/publicip/ip"}
			if !reflect.DeepEqual(f.paths, want) {
				t.Fatalf("preflight requests=%v want=%v", f.paths, want)
			}
		})
	}
	for _, status := range []string{"stopped", "starting", "stopping", "crashed"} {
		t.Run(status, func(t *testing.T) {
			f := newGluetunFixture()
			f.status = status
			from, to := f.helpers(t)
			if err := gluetunTarget().preflight(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
				t.Fatalf("unready tunnel: %v", err)
			}
			if len(f.paths) != 3 {
				t.Fatalf("unready tunnel made extra requests: %v", f.paths)
			}
		})
	}
}

func TestGluetunOptionalGeographyAndEmptyReadiness(t *testing.T) {
	f := newGluetunFixture()
	summary := f.result.([]any)[0].(map[string]any)["summary"].(map[string]any)
	summary["country"], summary["city"] = "Germany", ""
	from, to := f.helpers(t)
	if err := verifyGluetun(t.Context(), from, to, "gluetun-owned"); err != nil {
		t.Fatal(err)
	}
	f.ip = ""
	if err := gluetunTarget().preflight(t.Context(), from, to); !errors.Is(err, helpers.ErrManual) {
		t.Fatalf("running tunnel without a discovered public IP must remain Manual: %v", err)
	}
}

func TestGluetunNativeSummaryAndOneStatsSample(t *testing.T) {
	for _, status := range []string{"running", "stopped", "starting", "stopping", "crashed"} {
		t.Run(status, func(t *testing.T) {
			f := newGluetunFixture()
			summary := f.result.([]any)[0].(map[string]any)["summary"].(map[string]any)
			summary["vpnStatus"], summary["publicIp"] = status, ""
			f.stats.values = map[string]any{"status": "running", "publicIp": "2001:4860:4860::8888", "country": nil}
			from, to := f.helpers(t)
			if err := gluetunTarget().verifyData(t.Context(), from, to, "gluetun-owned"); err != nil {
				t.Fatal(err)
			}
			want := []string{"/api/trpc/info.getInfo", "/api/trpc/widget.vpn.getSummaries", "/api/trpc/widget.stats.catalog", "/api/trpc/widget.stats.snapshot", "/api/trpc/widget.stats.refresh"}
			if !reflect.DeepEqual(f.paths, want) || f.stats.refreshes != 1 || !f.stats.force || f.stats.integrationID != "gluetun-owned" {
				t.Fatalf("verification did not use one owned sample: %v", f.paths)
			}
		})
	}
}

func TestGluetunRejectsMalformedNativeSummaryBeforeStats(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		change func(*gluetunFixture)
	}{
		{"no results", func(f *gluetunFixture) { f.result = []any{} }},
		{"null summary", func(f *gluetunFixture) { f.result.([]any)[0].(map[string]any)["summary"] = nil }},
		{"wrong identity", func(f *gluetunFixture) {
			f.result.([]any)[0].(map[string]any)["integration"].(map[string]any)["id"] = "user-owned"
		}},
		{"wrong kind", func(f *gluetunFixture) {
			f.result.([]any)[0].(map[string]any)["integration"].(map[string]any)["kind"] = "mock"
		}},
		{"reported failure", func(f *gluetunFixture) { f.result.([]any)[0].(map[string]any)["error"] = "failed" }},
		{"unknown status", func(f *gluetunFixture) {
			f.result.([]any)[0].(map[string]any)["summary"].(map[string]any)["vpnStatus"] = "unknown"
		}},
		{"missing IP", func(f *gluetunFixture) {
			delete(f.result.([]any)[0].(map[string]any)["summary"].(map[string]any), "publicIp")
		}},
		{"null metadata", func(f *gluetunFixture) {
			f.result.([]any)[0].(map[string]any)["summary"].(map[string]any)["country"] = nil
		}},
		{"malformed metadata", func(f *gluetunFixture) { f.result.([]any)[0].(map[string]any)["summary"].(map[string]any)["city"] = 1 }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newGluetunFixture()
			scenario.change(f)
			from, to := f.helpers(t)
			if err := gluetunTarget().verifyData(t.Context(), from, to, "gluetun-owned"); err == nil {
				t.Fatal("accepted malformed native data")
			}
			if f.stats.catalogs != 0 || f.stats.refreshes != 0 {
				t.Fatal("native failure acquired Stats")
			}
		})
	}
}

func TestGluetunStatsSemantics(t *testing.T) {
	for _, status := range []string{"running", "stopped", "starting", "stopping", "crashed"} {
		for _, ip := range []string{"", "203.0.113.42", "2001:4860:4860::8888"} {
			sample := statsSample{values: map[string]any{"status": status, "publicIp": ip}, units: map[string]string{"status": "text", "publicIp": "text"}}
			if err := validateGluetunStats(sample); err != nil {
				t.Fatalf("valid %s/%s: %v", status, ip, err)
			}
		}
	}
	for _, badIP := range []any{nil, 0, "not-an-ip", "127.0.0.1", "192.168.1.1", "169.254.1.1", "::", "fc00::1", "ff02::1", "2001:4860::1%zone"} {
		sample := statsSample{values: map[string]any{"status": "running", "publicIp": badIP}, units: map[string]string{"status": "text", "publicIp": "text"}}
		if err := validateGluetunStats(sample); err == nil {
			t.Fatalf("accepted invalid public IP %v", badIP)
		}
	}
	for _, badStatus := range []any{nil, false, 0, "", "connected"} {
		if err := validateGluetunStatusAndIP(badStatus, ""); err == nil {
			t.Fatalf("accepted invalid status %v", badStatus)
		}
	}
	if err := validateGluetunStats(statsSample{values: map[string]any{"status": "running", "publicIp": ""}, units: map[string]string{"status": "count", "publicIp": "text"}}); err == nil {
		t.Fatal("accepted wrong Stats unit")
	}
}

func TestGluetunStatsRejectsNonAdvancingRefresh(t *testing.T) {
	f := newGluetunFixture()
	f.stats.advance = false
	from, to := f.helpers(t)
	if err := gluetunTarget().verifyData(t.Context(), from, to, "gluetun-owned"); err == nil {
		t.Fatal("accepted cached/no-op Stats")
	}
	if f.stats.refreshes != 1 || f.stats.catalogs != 1 {
		t.Fatal("failed refresh retried or reread the catalog")
	}
}
