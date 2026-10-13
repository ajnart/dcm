package homarr

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

func TestReadDownloadsQueue(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		change    func(map[string]any) any
		status    int
		bodyError bool
		wantError bool
	}{
		{name: "explicit empty queue"},
		{name: "metadata and nullable item fields", change: func(result map[string]any) any {
			result["integration"].(map[string]any)["updatedAt"] = "2026-10-13T12:00:00Z"
			result["data"].(map[string]any)["items"] = []any{map[string]any{"time": -1, "downSpeed": nil}}
			return []any{result}
		}},
		{name: "response count belongs to adapter", change: func(result map[string]any) any {
			result["data"].(map[string]any)["items"] = make([]any, 51)
			return []any{result}
		}},
		{name: "no results", wantError: true, change: func(map[string]any) any { return []any{} }},
		{name: "multiple results", wantError: true, change: func(result map[string]any) any { return []any{result, result} }},
		{name: "nonarray result", wantError: true, change: func(result map[string]any) any { return result }},
		{name: "nonobject result", wantError: true, change: func(map[string]any) any { return []any{nil} }},
		{name: "outer identity", wantError: true, change: func(result map[string]any) any { result["integrationId"] = "other"; return []any{result} }},
		{name: "nested identity", wantError: true, change: func(result map[string]any) any {
			result["integration"].(map[string]any)["id"] = "other"
			return []any{result}
		}},
		{name: "kind", wantError: true, change: func(result map[string]any) any {
			result["integration"].(map[string]any)["kind"] = "transmission"
			return []any{result}
		}},
		{name: "missing integration", wantError: true, change: func(result map[string]any) any { delete(result, "integration"); return []any{result} }},
		{name: "per-result error", wantError: true, change: func(result map[string]any) any { result["error"] = "private-fixture-marker"; return []any{result} }},
		{name: "false is still an error field", wantError: true, change: func(result map[string]any) any { result["error"] = false; return []any{result} }},
		{name: "null data", wantError: true, change: func(result map[string]any) any { result["data"] = nil; return []any{result} }},
		{name: "null status", wantError: true, change: func(result map[string]any) any { result["data"].(map[string]any)["status"] = nil; return []any{result} }},
		{name: "missing items", wantError: true, change: func(result map[string]any) any {
			delete(result["data"].(map[string]any), "items")
			return []any{result}
		}},
		{name: "null items", wantError: true, change: func(result map[string]any) any { result["data"].(map[string]any)["items"] = nil; return []any{result} }},
		{name: "object items", wantError: true, change: func(result map[string]any) any {
			result["data"].(map[string]any)["items"] = map[string]any{}
			return []any{result}
		}},
		{name: "HTTP rejection", status: http.StatusUnauthorized, wantError: true},
		{name: "tRPC body error", bodyError: true, wantError: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			result := map[string]any{
				"integrationId": "owned",
				"integration":   map[string]any{"id": "owned", "kind": "deluge"},
				"data":          map[string]any{"status": map[string]any{"paused": false}, "items": []any{}},
			}
			var value any = []any{result}
			if scenario.change != nil {
				value = scenario.change(result)
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != http.MethodGet || r.URL.Path != "/api/trpc/widget.downloads.getJobsAndStatuses" || r.Header.Get("ApiKey") != "fixture-key" {
					t.Error("Downloads request did not use the existing authenticated read transport")
				}
				var input struct {
					JSON struct {
						IntegrationIDs []string `json:"integrationIds"`
						Limit          int      `json:"limitPerIntegration"`
					} `json:"json"`
				}
				if json.Unmarshal([]byte(r.URL.Query().Get("input")), &input) != nil || len(input.JSON.IntegrationIDs) != 1 || input.JSON.IntegrationIDs[0] != "owned" || input.JSON.Limit != 50 {
					t.Error("Downloads request did not preserve its identity and limit")
				}
				if scenario.status != 0 {
					w.WriteHeader(scenario.status)
					w.Write([]byte("private-fixture-marker"))
					return
				}
				if scenario.bodyError {
					w.Write([]byte(`{"error":{"json":{"message":"private-fixture-marker"}}}`))
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"result": map[string]any{"data": map[string]any{"json": value}}})
			}))
			t.Cleanup(server.Close)
			h := helpers.New(helpers.Config{App: "homarr", BaseURL: server.URL, HTTP: server.Client(), Log: events.Discard(), Secrets: statsSecrets{"HOMARR_API_KEY": "fixture-key"}})
			queue, err := readDownloadsQueue(t.Context(), h, "owned", "deluge")
			if (err != nil) != scenario.wantError {
				t.Fatalf("error = %v, want failure %v", err, scenario.wantError)
			}
			if calls != 1 {
				t.Fatalf("made %d requests, want one", calls)
			}
			if err != nil {
				if strings.Contains(err.Error(), "private-fixture-marker") {
					t.Fatal("raw response reached the error")
				}
				return
			}
			if queue.integration["id"] != "owned" || queue.status["paused"] != false || queue.items == nil {
				t.Fatal("queue identity/status/explicit array was not preserved")
			}
			if scenario.name == "metadata and nullable item fields" {
				item := queue.items[0].(map[string]any)
				if queue.integration["updatedAt"] != "2026-10-13T12:00:00Z" || item["time"] != float64(-1) || item["downSpeed"] != nil {
					t.Fatal("adapter-owned fields were normalized")
				}
			}
		})
	}
}
