package stirlingpdf_test

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/stirlingpdf"
	"github.com/ajnart/self-host/internal/events"
	"github.com/ajnart/self-host/internal/helpers"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

// Stirling PDF v3.0.0 serves root as text/html, while its documented container
// healthcheck reads the JSON status map from /api/v1/info/status. Exercise both
// public readiness operations without relaxing the shared JSON Accept header.
func TestReadinessUsesJSONStatusWhenFrontendRefusesJSON(t *testing.T) {
	requests := 0
	client := &http.Client{Transport: transport(func(request *http.Request) (*http.Response, error) {
		requests++
		if got := request.Header.Get("Accept"); got != "application/json" {
			t.Errorf("Accept = %q, want shared JSON negotiation", got)
		}
		status, body := http.StatusNotFound, ""
		switch request.URL.Path {
		case "/":
			status = http.StatusNotAcceptable
		case "/api/v1/info/status":
			status, body = http.StatusOK, `{"status":"UP","version":"3.0.0"}`
		}
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	h := helpers.New(helpers.Config{App: "stirling-pdf", BaseURL: "http://stirling-fixture.invalid", URL: "http://stirling-fixture.invalid", HTTP: client, Log: events.Discard()})
	application := stirlingpdf.App{}
	if err := application.Check(context.Background(), h); err != nil {
		t.Fatalf("Check must accept the pinned JSON health endpoint: %v", err)
	}
	if err := application.Setup(context.Background(), h); err != nil {
		t.Fatalf("Setup must accept the pinned JSON health endpoint: %v", err)
	}
	if requests != 2 {
		t.Errorf("healthy Check and Setup made %d requests, want one each", requests)
	}
}
