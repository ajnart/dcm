// Package telemetrytest is the fake network behind Telemetry tests: it
// answers like PostHog and keeps every payload the CLI tried to send.
package telemetrytest

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
)

// Transport is an http.RoundTripper that records request bodies.
type Transport struct {
	// Hold, when set, makes every request wait until it is closed, like a
	// PostHog that never answers.
	Hold <-chan struct{}

	mu     sync.Mutex
	bodies []string
}

func (t *Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
		req.Body.Close()
	}
	t.mu.Lock()
	t.bodies = append(t.bodies, string(body))
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

// Store is an in-memory Home folder.
type Store struct {
	mu    sync.Mutex
	files map[string][]byte
}

func (s *Store) ReadHomeFile(name string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.files[name]
	if !ok {
		return nil, os.ErrNotExist
	}
	return data, nil
}

func (s *Store) WriteHomeFile(name string, data []byte, _ os.FileMode) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.files == nil {
		s.files = map[string][]byte{}
	}
	s.files[name] = append([]byte(nil), data...)
	return nil
}

// Remove deletes a file, as a person deleting it from the Home folder would.
func (s *Store) Remove(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, name)
}
