package e2e

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/service"
)

// Public CLI Status redacts step Error/Hint and DockerError at the service
// boundary. Copy only those fields and allowlisted readiness observations;
// Settings, paths, URLs, raw output and unowned App records stay private.
func statusReadinessDiagnostics(document string, expected []string, containersOK bool) []event {
	fallback := func(message string) []event { return []event{{Event: "run.error", Error: message}} }
	var doc service.Status
	if json.Unmarshal([]byte(document), &doc) != nil || doc.Apps == nil {
		return fallback("public status document unavailable or invalid while waiting for readiness")
	}
	owned := map[string]service.AppStatus{}
	var duplicates bool
	for _, app := range doc.Apps {
		if _, exists := owned[app.ID]; exists {
			duplicates = true
		}
		owned[app.ID] = app
	}
	var out []event
	for _, id := range expected {
		app, exists := owned[id]
		if !exists {
			out = append(out, event{Event: events.StepFail, App: id, Step: "status", Error: "App missing from public status document", Hint: "self-host status --json"})
			continue
		}
		for _, step := range app.Steps {
			if step.Status == "fail" && step.ID != "" && step.Error != "" {
				out = append(out, event{Event: events.StepFail, App: id, Step: step.ID, Error: step.Error, Hint: step.Hint})
			}
		}
		if app.State == "unknown" && doc.DockerError != "" {
			out = append(out, event{Event: events.StepFail, App: id, Step: "docker-status", Error: doc.DockerError, Hint: "self-host doctor --json"})
		}
		if !readyStatus([]statusEntry{{ID: id, State: app.State, Health: app.Health, Setup: app.Setup}}, []string{id}) {
			out = append(out, event{Event: events.StepFail, App: id, Step: "status", Error: fmt.Sprintf("App readiness not satisfied: state=%s health=%s setup=%s", safeStatusValue(app.State), safeStatusValue(app.Health), safeStatusValue(app.Setup)), Hint: "self-host logs " + id})
		}
	}
	if len(out) != 0 {
		return out
	}
	if doc.DockerError != "" {
		return fallback("Docker status observation failed: " + doc.DockerError)
	}
	if duplicates || len(doc.Apps) != len(expected) {
		return fallback("public status document did not contain the exact owned App set")
	}
	if !containersOK {
		return fallback("owned Compose service inventory did not satisfy running, successful completion and health requirements")
	}
	return nil
}

func safeStatusValue(value string) string {
	switch value {
	case "running", "exited", "degraded", "missing", "unknown", "restarting", "created", "paused", "dead", "removing",
		"healthy", "unhealthy", "starting", "broken", "ok", "incomplete", "pending", "unmanaged":
		return value
	case "":
		return "none"
	default:
		return "unrecognized"
	}
}

func composeReadinessDiagnostics(document string, expected []string) []event {
	fallback := func(message string) []event { return []event{{Event: "run.error", Error: message}} }
	if containersReadyJSON(document, expected) {
		return nil
	}
	var rows []containerEntry
	if strings.HasPrefix(strings.TrimSpace(document), "[") {
		if json.Unmarshal([]byte(document), &rows) != nil {
			return fallback("owned Compose service inventory unavailable or invalid")
		}
	} else {
		decoder := json.NewDecoder(strings.NewReader(document))
		for {
			var row containerEntry
			if err := decoder.Decode(&row); err == io.EOF {
				break
			} else if err != nil {
				return fallback("owned Compose service inventory unavailable or invalid")
			}
			rows = append(rows, row)
		}
	}
	owned := map[string][]containerEntry{}
	duplicateExpected := map[string]bool{}
	for _, name := range expected {
		if _, exists := owned[name]; exists {
			duplicateExpected[name] = true
		}
		owned[name] = nil
	}
	unexpected := false
	for _, row := range rows {
		if _, allowed := owned[row.Service]; allowed {
			owned[row.Service] = append(owned[row.Service], row)
		} else {
			unexpected = true
		}
	}
	var out []event
	for _, name := range expected {
		entries := owned[name]
		if len(entries) == 0 {
			out = append(out, event{Event: "run.error", Error: fmt.Sprintf("owned Compose service readiness: service=%s state=missing health=none exit_code=unknown", name)})
			continue
		}
		row := entries[0]
		data, _ := json.Marshal([]containerEntry{row})
		if len(entries) == 1 && containersReadyJSON(string(data), []string{name}) {
			continue
		}
		exit := "unknown"
		if row.ExitCode != nil {
			exit = strconv.Itoa(*row.ExitCode)
		}
		prefix := "owned Compose service readiness"
		if len(entries) > 1 {
			prefix = "owned Compose service has duplicate inventory entries"
		}
		out = append(out, event{Event: "run.error", Error: fmt.Sprintf("%s: service=%s state=%s health=%s exit_code=%s", prefix, name, safeStatusValue(row.State), safeStatusValue(row.Health), exit)})
	}
	if unexpected {
		out = append(out, event{Event: "run.error", Error: "owned Compose service inventory contains an unexpected service"})
	}
	if len(out) == 0 {
		duplicates := make([]string, 0, len(duplicateExpected))
		for name := range duplicateExpected {
			duplicates = append(duplicates, name)
		}
		sort.Strings(duplicates)
		return fallback(fmt.Sprintf("owned Compose service inventory did not contain the expected service set: expected_total=%d expected_unique=%d observed_total=%d duplicate_expected=%s", len(expected), len(owned), len(rows), strings.Join(duplicates, ",")))
	}
	return out
}
