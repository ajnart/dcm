package homarr

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestRequireCredentialSafeHomarr(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		result string
		status int
		raw    string
		admit  bool
	}{
		{name: "fixed 2.5.1", result: `{"version":"2.5.1"}`, admit: true},
		{name: "fixed 2.5.2", result: `{"version":"2.5.2"}`, admit: true},
		{name: "legacy version", result: `{"version":"2.4.1"}`},
		{name: "unfixed version", result: `{"version":"2.5.0"}`},
		{name: "unreviewed patch", result: `{"version":"2.5.3"}`},
		{name: "unknown version", result: `{"version":"private-fixture-marker"}`},
		{name: "missing version", result: `{}`},
		{name: "numeric version", result: `{"version":2.51}`},
		{name: "null result", result: `null`},
		{name: "malformed response", raw: `{private-fixture-marker`},
		{name: "HTTP query failure", status: http.StatusUnauthorized, raw: `private-fixture-marker`},
		{name: "tRPC query failure", raw: `{"error":{"json":{"message":"private-fixture-marker"}}}`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != http.MethodGet || r.URL.Path != "/api/trpc/info.getInfo" || r.Header.Get("ApiKey") != "fixture-key" {
					t.Error("preflight must only read the authenticated Homarr version")
					w.WriteHeader(http.StatusNotFound)
					return
				}
				if scenario.status != 0 {
					w.WriteHeader(scenario.status)
				}
				if scenario.raw != "" {
					w.Write([]byte(scenario.raw))
					return
				}
				w.Write([]byte(`{"result":{"data":{"json":` + scenario.result + `}}}`))
			}))
			t.Cleanup(server.Close)
			reported := []events.Event{}
			log := events.New(events.SinkFunc(func(event events.Event) { reported = append(reported, event) }))
			secrets := statsSecrets{"HOMARR_API_KEY": "fixture-key"}
			h := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: log, Secrets: secrets})
			const hint = "Back up Homarr, use version 2.5.1 or 2.5.2, then retry the fixture App's Homarr Link."
			err := requireCredentialSafeHomarr(t.Context(), h, hint)
			if scenario.admit {
				if err != nil || len(reported) != 0 {
					t.Fatalf("fixed version did not pass silently: %v", err)
				}
			} else {
				if err != helpers.ErrManual {
					t.Fatalf("unsafe or unreadable version must require Manual recovery: %v", err)
				}
				if len(reported) != 1 || reported[0].Event != events.Info || reported[0].Msg != hint || reported[0].Error != "" {
					t.Fatal("Manual recovery did not emit only the caller's fixed hint")
				}
			}
			if calls != 1 || len(secrets) != 1 || secrets["HOMARR_API_KEY"] != "fixture-key" {
				t.Fatal("preflight performed extra requests or changed credentials")
			}
		})
	}
}

func TestSupportedVersionKeepsNormalQueryFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)
	h := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
	err := supportedVersion(t.Context(), h)
	if err == nil || errors.Is(err, helpers.ErrManual) || !strings.HasPrefix(err.Error(), "cannot verify Homarr compatibility; use Homarr 2.4.1, 2.5.1 or 2.5.2") {
		t.Fatalf("normal compatibility query failure changed: %v", err)
	}
}
