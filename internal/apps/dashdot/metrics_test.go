package dashdot_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/dashdot"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func metricBodies() map[string]string {
	return map[string]string{
		"/config":   `{"config":{"widget_list":["cpu","ram"],"running_in_docker":false,"disable_background_stats_collection":true,"disable_integrations":false,"enable_cpu_temps":false}}`,
		"/info":     `{"cpu":{"brand":"Kernel CPU","model":"Model","threads":2},"ram":{"size":8192}}`,
		"/load/cpu": `[{"load":0,"temp":0},{"load":0,"temp":0}]`,
		"/load/ram": `{"load":0}`,
	}
}

func metricsHelper(t *testing.T, bodies map[string]string, rejected string) *helpers.H {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
			t.Error("Dash. metrics must use unauthenticated reads")
		}
		if r.URL.Path == rejected {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("private upstream response"))
			return
		}
		body, ok := bodies[r.URL.Path]
		if !ok {
			t.Errorf("unexpected Dash. path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return helpers.New(helpers.Config{App: "dashdot", BaseURL: srv.URL, HTTP: srv.Client(), Log: events.Discard()})
}

func TestCPUAndRAMReadinessAcceptsExplicitZeroAndReprobes(t *testing.T) {
	bodies := metricBodies()
	h := metricsHelper(t, bodies, "")
	application := dashdot.App{}
	for range 2 {
		if err := application.Setup(context.Background(), h); err != nil {
			t.Fatal(err)
		}
		if err := application.Check(context.Background(), h); err != nil {
			t.Fatal(err)
		}
	}
	bodies["/load/ram"] = `{}`
	if err := application.Check(context.Background(), h); err == nil {
		t.Fatal("Check accepted newly unavailable RAM data")
	}
}

func TestCPUAndRAMReadinessRejectsUnavailableOrUnsupportedData(t *testing.T) {
	for _, tc := range []struct{ name, path, body string }{
		{"missing configuration", "/config", `{}`},
		{"host scope", "/config", `{"config":{"widget_list":["cpu","ram","storage"],"running_in_docker":true,"disable_background_stats_collection":false,"disable_integrations":false,"enable_cpu_temps":false}}`},
		{"missing false configuration", "/config", `{"config":{"widget_list":["cpu","ram"],"disable_background_stats_collection":true}}`},
		{"unavailable inventory", "/info", `{"cpu":{"brand":"","model":"","threads":0},"ram":{"size":0}}`},
		{"missing inventory", "/info", `{}`},
		{"empty CPU", "/load/cpu", `[]`},
		{"missing CPU load", "/load/cpu", `[{"temp":0}]`},
		{"missing CPU temperature field", "/load/cpu", `[{"load":0}]`},
		{"invalid CPU percentage", "/load/cpu", `[{"load":101,"temp":0}]`},
		{"missing RAM", "/load/ram", `{}`},
		{"null RAM", "/load/ram", `{"load":null}`},
		{"negative RAM", "/load/ram", `{"load":-1}`},
		{"inconsistent RAM", "/load/ram", `{"load":8193}`},
		{"non-JSON", "/load/cpu", `unavailable`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bodies := metricBodies()
			bodies[tc.path] = tc.body
			if err := (dashdot.App{}).Check(context.Background(), metricsHelper(t, bodies, "")); err == nil {
				t.Fatal("accepted unavailable or unsupported metric data")
			}
		})
	}
}

func TestCPUAndRAMReadinessDoesNotEchoRejectedResponse(t *testing.T) {
	err := (dashdot.App{}).Check(context.Background(), metricsHelper(t, metricBodies(), "/load/ram"))
	if err == nil || strings.Contains(err.Error(), "private upstream response") || !strings.Contains(err.Error(), "self-host setup dashdot") {
		t.Fatalf("unexpected readiness error: %v", err)
	}
}

func TestCPUAndRAMComposeKeepsItsSecurityFootprint(t *testing.T) {
	fragment := (dashdot.App{}).Compose(app.RenderContext{Port: 3001})
	for _, forbidden := range []string{"privileged:", "volumes:", "cap_add:", "pid:", "network_mode:", "docker.sock", "/proc", "/sys"} {
		if strings.Contains(fragment, forbidden) {
			t.Fatalf("Dash. gained host access: %s", forbidden)
		}
	}
	for _, required := range []string{"read_only: true", `DASHDOT_RUNNING_IN_DOCKER: "false"`, "DASHDOT_WIDGET_LIST: cpu,ram", `DASHDOT_DISABLE_BACKGROUND_STATS_COLLECTION: "true"`} {
		if !strings.Contains(fragment, required) {
			t.Fatalf("Dash. lost its limited configuration: %s", required)
		}
	}
}
