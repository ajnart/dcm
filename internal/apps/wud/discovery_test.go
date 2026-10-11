package wud_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
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
	bulkPosts := 0
	base := handler()
	transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			if r.URL.Path == "/api/containers/watch" {
				bulkPosts++
			}
		}
		if r.URL.Path == "/api/containers" && authOK(r) {
			requests++
			if elapsed < time.Second {
				w.Write([]byte(`[]`))
				return
			}
			w.Write([]byte(`[{"id":"owned-fixture","name":"owned-fixture","watcher":"approved","updateAvailable":false,"image":{"id":"sha256:owned-image"}}]`))
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
	if elapsed < time.Second || requests < 2 || posts == 0 || bulkPosts != 1 {
		t.Fatal("Setup accepted authentication before approved discovery or refreshed beyond the sole approved watcher")
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

func TestSetupWaitsForFreshIdentityAfterRestoredInventoryCache(t *testing.T) {
	dir := t.TempDir()
	writeTLSFixture(t, dir, false)
	refreshed := false
	oldScans, newScans, refreshes := 0, 0, 0
	base := handler()
	transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !authOK(r) {
			base.ServeHTTP(w, r)
			return
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /api/containers":
			id := "restored-old"
			if refreshed {
				id = "restored-new"
			}
			w.Write([]byte(`[{"id":"` + id + `","name":"owned-fixture","watcher":"approved","updateAvailable":false,"image":{"id":"sha256:owned-image"}}]`))
			return
		case "POST /api/containers/restored-old/watch":
			oldScans++
			w.WriteHeader(404)
			return
		case "POST /api/containers/restored-new/watch":
			newScans++
			w.Write([]byte(`{"id":"restored-new","watcher":"approved","image":{"id":"sha256:owned-image"}}`))
			return
		case "POST /api/containers/watch":
			refreshes++
			refreshed = true
			w.Write([]byte(`[{"id":"restored-new","watcher":"approved","image":{"id":"sha256:owned-image"}}]`))
			return
		}
		base.ServeHTTP(w, r)
	})}
	h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
	if err := (wud.App{}).Setup(context.Background(), h); err != nil {
		t.Fatal(err)
	}
	if oldScans == 0 || newScans == 0 || refreshes != 1 {
		t.Fatal("Setup accepted restored cached identity without approved refresh and current per-container proof")
	}
}

func TestSetupDiscoveryRejectsPersistentOrMismatchedFreshIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"persistent stale cache", ``, 404},
		{"foreign container", `{"id":"foreign","watcher":"approved","image":{"id":"sha256:owned-image"}}`, 200},
		{"foreign watcher", `{"id":"owned-fixture","watcher":"other","image":{"id":"sha256:owned-image"}}`, 200},
		{"different image", `{"id":"owned-fixture","watcher":"approved","image":{"id":"sha256:other"}}`, 200},
		{"malformed fresh response", `synthetic-private-response`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeTLSFixture(t, dir, false)
			base := handler()
			scans := 0
			transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" && r.URL.Path == "/api/containers/owned-fixture/watch" && authOK(r) {
					scans++
					w.WriteHeader(tc.status)
					w.Write([]byte(tc.body))
					return
				}
				base.ServeHTTP(w, r)
			})}
			h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
			if err := (wud.App{}).Setup(context.Background(), h); err == nil || scans == 0 || scans > 15 {
				t.Fatal("invalid fresh identity was accepted or retried without a bound")
			}
		})
	}
}

func TestSetupRefusesRefreshUnlessOnlyExactApprovedWatcherExists(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"none", `[]`, 200},
		{"foreign", `[{"id":"docker.other","type":"docker","name":"synthetic-private-value"}]`, 200},
		{"non Docker", `[{"id":"kubernetes.approved","type":"kubernetes","name":"approved"}]`, 200},
		{"duplicate", `[{"id":"docker.approved","type":"docker","name":"approved"},{"id":"docker.approved","type":"docker","name":"approved"}]`, 200},
		{"other watcher also registered", `[{"id":"docker.approved","type":"docker","name":"approved"},{"id":"docker.other","type":"docker","name":"other"}]`, 200},
		{"missing identity", `[{"type":"docker","name":"approved"}]`, 200},
		{"malformed", `synthetic-private-value`, 200},
		{"refused", `synthetic-private-value`, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeTLSFixture(t, dir, false)
			base := handler()
			refreshes := 0
			transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if authOK(r) {
					if r.Method == "GET" && r.URL.Path == "/api/containers" {
						w.Write([]byte(`[]`))
						return
					}
					if r.Method == "GET" && r.URL.Path == "/api/watchers" {
						w.WriteHeader(tc.status)
						w.Write([]byte(tc.body))
						return
					}
					if r.Method == "POST" && r.URL.Path == "/api/containers/watch" {
						refreshes++
						w.WriteHeader(200)
						return
					}
				}
				base.ServeHTTP(w, r)
			})}
			h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
			err := (wud.App{}).Setup(context.Background(), h)
			if err == nil || refreshes != 0 || strings.Contains(err.Error(), "synthetic-private-value") {
				t.Fatal("ambiguous or foreign watcher registration received an automatic refresh")
			}
		})
	}
}

func TestSetupFreshApprovedInventorySkipsAutomaticRefresh(t *testing.T) {
	dir := t.TempDir()
	writeTLSFixture(t, dir, false)
	base := handler()
	registrations, refreshes := 0, 0
	transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/watchers" {
			registrations++
			w.WriteHeader(403)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/api/containers/watch" {
			refreshes++
			w.WriteHeader(500)
			return
		}
		base.ServeHTTP(w, r)
	})}
	h := tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport)
	for range 2 {
		if err := (wud.App{}).Setup(context.Background(), h); err != nil {
			t.Fatal(err)
		}
	}
	if registrations != 0 || refreshes != 0 || h.AdminUser() != adminUser || h.AdminPassword() != adminPass {
		t.Fatal("already fresh approved inventory triggered a refresh or changed administrator credentials")
	}
}
