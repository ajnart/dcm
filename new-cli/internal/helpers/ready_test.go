package helpers_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

func stepStatus(t *testing.T, results []helpers.StepResult, id string) helpers.StepResult {
	t.Helper()
	for i := len(results) - 1; i >= 0; i-- {
		if results[i].ID == id {
			return results[i]
		}
	}
	return helpers.StepResult{}
}

func TestReadySkipsWhenAlreadyAnswering(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	if err := h.Ready(context.Background(), "/health"); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	got := stepStatus(t, results, "ready")
	if got.Status != "skip" {
		t.Errorf("ready status = %q, want skip", got.Status)
	}
}

func TestReadyDefaultAcceptsAnyStatusBelow500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	if err := h.Ready(context.Background(), "/"); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if got := stepStatus(t, results, "ready"); got.Status != "skip" {
		t.Errorf("ready status = %q, want skip for HTTP 401", got.Status)
	}
}

func TestReadyPollsUntilOK(t *testing.T) {
	var mu sync.Mutex
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		n := requests
		mu.Unlock()
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	if err := h.Ready(context.Background(), "/health", helpers.Timeout(time.Minute)); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	if got := stepStatus(t, results, "ready"); got.Status != "ok" {
		t.Errorf("ready status = %q, want ok", got.Status)
	}
	mu.Lock()
	defer mu.Unlock()
	if requests < 3 {
		t.Errorf("requests = %d, want at least 3", requests)
	}
}

func TestReadyWantStatusRejectsOtherwise(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	err := h.Ready(context.Background(), "/", helpers.WantStatus(http.StatusOK), helpers.Timeout(time.Second))
	if err == nil {
		t.Fatal("Ready = nil, want failure for a status outside WantStatus")
	}
	if got := stepStatus(t, results, "ready"); got.Status != "fail" {
		t.Errorf("ready status = %q, want fail", got.Status)
	}
}

func TestReadyContains(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("service is healthy"))
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	if err := h.Ready(context.Background(), "/", helpers.Contains("healthy")); err != nil {
		t.Fatalf("Ready with matching Contains: %v", err)
	}
	results = nil
	err := h.Ready(context.Background(), "/", helpers.Contains("ready"), helpers.Timeout(time.Second))
	if err == nil {
		t.Fatal("Ready = nil, want failure when the body lacks Contains")
	}
}

func TestReadyNoRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	if err := h.Ready(context.Background(), "/", helpers.NoRedirect(), helpers.WantStatus(http.StatusFound)); err != nil {
		t.Fatalf("Ready with NoRedirect: %v", err)
	}
}

func TestReadyMessageNamesTheAppAndPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	var results []helpers.StepResult
	h := newH(t, srv, nil, &results)

	if err := h.Ready(context.Background(), "/health"); err != nil {
		t.Fatalf("Ready: %v", err)
	}
	got := stepStatus(t, results, "ready")
	if !strings.Contains(got.Msg, "answer on /health") {
		t.Errorf("message = %q, want it to name the path", got.Msg)
	}
}
