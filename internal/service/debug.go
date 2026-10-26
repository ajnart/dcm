package service

import (
	"context"
	"fmt"
	"slices"
	"strings"

	stepstatus "github.com/ajnart/self-host/internal/status"
)

const debugLogLines = 100

const debugWorkingPage = "any answer below HTTP 500, such as the app's page or a sign-in page; HTTP 5xx, a timeout or an empty reply means it is not up"

type DebugHealthCheck struct {
	URL string `json:"url,omitempty"`
	// Working says what a working page returns.
	Working string `json:"working,omitempty"`
}

// DebugReport is everything an agent needs to start fixing a broken App,
// with every known secret masked.
type DebugReport struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Managed   bool             `json:"managed"`
	State     string           `json:"state"`
	Health    string           `json:"health,omitempty"`
	Setup     stepstatus.Setup `json:"setup"`
	Image     string           `json:"image,omitempty"`
	Addresses []string         `json:"addresses,omitempty"`
	// DockerError is set when container state could not be read.
	DockerError string `json:"docker_error,omitempty"`
	DockerHint  string `json:"docker_hint,omitempty"`
	DockerDocs  string `json:"docker_docs,omitempty"`
	// FailedSteps are the Setup steps that failed or wait for a person.
	FailedSteps []StepStatus `json:"failed_steps,omitempty"`
	Docs        string       `json:"docs,omitempty"`
	Logs        []string     `json:"logs"`
	// LogLines is how many of the latest log lines the report keeps at most.
	LogLines    int              `json:"log_lines"`
	LogsError   string           `json:"logs_error,omitempty"`
	HealthCheck DebugHealthCheck `json:"health_check"`
}

// Debug builds the Debug report of one App from its Status, its recorded
// Setup steps and its recent logs. It runs no probe of its own.
func (s *Service) Debug(ctx context.Context, id string) (DebugReport, error) {
	status, err := s.Status(ctx)
	if err != nil {
		return DebugReport{}, err
	}
	var as *AppStatus
	for i := range status.Apps {
		if status.Apps[i].ID == id {
			as = &status.Apps[i]
		}
	}
	if as == nil {
		return DebugReport{}, fmt.Errorf("%s is not in the Project (see: self-host status)", id)
	}
	report := debugReportOf(*as, status.DockerError)
	report.DockerHint, report.DockerDocs = status.DockerHint, status.DockerDocs
	if a, found := s.Catalog.App(id); found {
		report.Docs = a.Info().Docs
	}
	report.Logs, report.LogsError = s.debugLogs(ctx, id)
	return s.maskDebug(report), nil
}

func debugReportOf(as AppStatus, dockerError string) DebugReport {
	report := DebugReport{ID: as.ID, Name: as.Name, Managed: as.Managed, State: as.State, Health: as.Health,
		Setup: as.Setup, Image: as.Image, Addresses: slices.Clone(as.Addresses), DockerError: dockerError,
		Logs: []string{}, LogLines: debugLogLines}
	if as.URL != "" {
		report.HealthCheck = DebugHealthCheck{URL: as.observationURL(), Working: debugWorkingPage}
	}
	for _, step := range as.Steps {
		if step.Status.NeedsAttention() {
			report.FailedSteps = append(report.FailedSteps, step)
		}
	}
	return report
}

func (s *Service) debugLogs(ctx context.Context, id string) ([]string, string) {
	ss, err := s.open(ctx)
	if err != nil {
		return []string{}, err.Error()
	}
	services, err := ss.services(id)
	if err != nil {
		return []string{}, err.Error()
	}
	text, err := ss.compose.LogText(ctx, debugLogLines, services...)
	lines := []string{}
	for _, line := range strings.Split(strings.TrimRight(text, "\r\n"), "\n") {
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) > debugLogLines {
		lines = lines[len(lines)-debugLogLines:]
	}
	if err != nil {
		return lines, err.Error()
	}
	return lines, ""
}

// maskDebug passes every text field through the redaction the event sinks use.
func (s *Service) maskDebug(r DebugReport) DebugReport {
	mask := s.Log.Redact
	r.Name, r.Image, r.Docs = mask(r.Name), mask(r.Image), mask(r.Docs)
	r.DockerError, r.LogsError = mask(r.DockerError), mask(r.LogsError)
	r.DockerHint, r.DockerDocs = mask(r.DockerHint), mask(r.DockerDocs)
	r.HealthCheck.URL = mask(r.HealthCheck.URL)
	for i, address := range r.Addresses {
		r.Addresses[i] = mask(address)
	}
	for i, step := range r.FailedSteps {
		r.FailedSteps[i].Msg, r.FailedSteps[i].Error, r.FailedSteps[i].Hint = mask(step.Msg), mask(step.Error), mask(step.Hint)
	}
	for i, line := range r.Logs {
		r.Logs[i] = mask(line)
	}
	return r
}
