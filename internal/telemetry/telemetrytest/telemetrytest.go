// Package telemetrytest is the fake network behind Telemetry tests: it
// answers like PostHog and keeps every payload the CLI tried to send.
package telemetrytest

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
)

// Transport is an http.RoundTripper that records request bodies.
type Transport struct {
	// Hold, when set, makes every request wait until it is closed, like a
	// PostHog that never answers.
	Hold <-chan struct{}

	mu      sync.Mutex
	bodies  []string
	urls    []string
	headers []http.Header
}

func (t *Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
		req.Body.Close()
	}
	t.mu.Lock()
	t.bodies = append(t.bodies, string(body))
	t.urls = append(t.urls, req.URL.String())
	t.headers = append(t.headers, req.Header.Clone())
	t.mu.Unlock()
	if t.Hold != nil {
		select {
		case <-t.Hold:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     http.Header{"Content-Type": {"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"status":"Ok"}`)),
		Request:    req,
	}, nil
}

// Client returns an http.Client that uses the Transport.
func (t *Transport) Client() *http.Client { return &http.Client{Transport: t} }

// Bodies returns every request body sent so far, verbatim.
func (t *Transport) Bodies() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string(nil), t.bodies...)
}

// URLs returns the address of every request sent so far.
func (t *Transport) URLs() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string(nil), t.urls...)
}

func (t *Transport) LogRequests() []LogRequest {
	t.mu.Lock()
	defer t.mu.Unlock()
	var out []LogRequest
	for i, u := range t.urls {
		if !strings.HasSuffix(strings.SplitN(u, "?", 2)[0], "/i/v1/logs") {
			continue
		}
		var body map[string]any
		json.Unmarshal([]byte(t.bodies[i]), &body)
		out = append(out, LogRequest{URL: u, Header: t.headers[i], Body: body})
	}
	return out
}

type LogRequest struct {
	URL    string
	Header http.Header
	Body   map[string]any
}

func (t *Transport) LogRecords() []map[string]any {
	var out []map[string]any
	for _, r := range t.LogRequests() {
		for _, rl := range list(r.Body["resourceLogs"]) {
			for _, sl := range list(rl["scopeLogs"]) {
				for _, rec := range list(sl["logRecords"]) {
					flat := map[string]any{"severityText": rec["severityText"]}
					if body, ok := rec["body"].(map[string]any); ok {
						flat["body"] = body["stringValue"]
					}
					for _, attr := range list(rec["attributes"]) {
						if value, ok := attr["value"].(map[string]any); ok {
							flat[attr["key"].(string)] = value["stringValue"]
						}
					}
					out = append(out, flat)
				}
			}
		}
	}
	return out
}

func list(v any) []map[string]any {
	var out []map[string]any
	items, _ := v.([]any)
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// Events returns every captured event, in the order sent.
func (t *Transport) Events() []map[string]any {
	var events []map[string]any
	for _, body := range t.Bodies() {
		var batch struct {
			Batch []map[string]any `json:"batch"`
		}
		if json.Unmarshal([]byte(body), &batch) == nil {
			events = append(events, batch.Batch...)
		}
	}
	return events
}
