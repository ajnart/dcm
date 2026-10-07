package wud_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/ajnart/self-host/internal/apps/wud"
)

func TestSetupWaitsForApprovedDiscoveryInsteadOfAuthenticationAlone(t *testing.T) {
	dir := t.TempDir()
	writeTLSFixture(t, dir, false)
	elapsed := time.Duration(0)
	requests := 0
	posts := 0
	base := handler()
	transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
		}
		if r.URL.Path == "/api/containers" && authOK(r) {
			requests++
			if elapsed < time.Second {
				w.Write([]byte(`[]`))
				return
			}
			w.Write([]byte(`[{"id":"owned-fixture","watcher":"approved","image":{"id":"sha256:owned-image"}}]`))
			return
		}
		base.ServeHTTP(w, r)
	})}
	h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
	sleep := h.Sleep
	h.Sleep = func(ctx context.Context, d time.Duration) error { elapsed += d; return sleep(ctx, d) }
	if err := (wud.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if elapsed < time.Second || requests < 2 || posts != 0 {
		t.Fatal("Setup accepted authentication before approved discovery or forced a watcher scan")
	}
}

func TestSetupDiscoveryRejectsInvalidInventoryWithinBoundedWait(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"absent", `[]`, 200},
		{"foreign", `[{"id":"foreign","watcher":"other","image":{"id":"sha256:foreign"}}]`, 200},
		{"malformed", `synthetic-private-response`, 200},
		{"refused", `synthetic-private-response`, 403},
		{"incomplete", `[{"id":"owned","watcher":"approved"}]`, 200},
		{"watcher error", `[{"id":"owned","watcher":"approved","image":{"id":"sha256:owned"},"error":{"message":"synthetic-private-response"}}]`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeTLSFixture(t, dir, false)
			base := handler()
			requests := 0
			transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/containers" && authOK(r) {
					requests++
					w.WriteHeader(tc.status)
					w.Write([]byte(tc.body))
					return
				}
				base.ServeHTTP(w, r)
			})}
			h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
			start := h.Now()
			if err := (wud.App{}).Setup(context.Background(), h); err == nil {
				t.Fatal("invalid inventory was accepted")
			}
			if requests == 0 || requests > 15 || h.Now().Sub(start) > 15*time.Second {
				t.Fatal("discovery did not fail within its bounded semantic wait")
			}
		})
	}
}

func TestSetupDiscoveryStopsOnCancellationAndDeadline(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "deadline"}[deadline], func(t *testing.T) {
			dir := t.TempDir()
			writeTLSFixture(t, dir, false)
			ctx, cancel := context.WithCancel(context.Background())
			expected := error(context.Canceled)
			if deadline {
				cancel()
				ctx, cancel = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				expected = context.DeadlineExceeded
			}
			defer cancel()
			base := handler()
			requests := 0
			transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/containers" && authOK(r) {
					requests++
					cancel()
					w.Write([]byte(`[]`))
					return
				}
				base.ServeHTTP(w, r)
			})}
			h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
			err := (wud.App{}).Setup(ctx, h)
			if !errors.Is(err, expected) || requests > 1 {
				t.Fatal("discovery ignored cancellation or deadline")
			}
		})
	}
}
