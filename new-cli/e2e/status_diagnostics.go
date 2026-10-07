package e2e

import (
	"encoding/json"
	"fmt"

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
