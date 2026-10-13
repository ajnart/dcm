package homarr_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/gatus"
	"github.com/ajnart/self-host/internal/systemtest"
)

func TestGatusLinkRefreshesOncePerVerificationAndSkipsStatsOnRemoval(t *testing.T) {
	fake := newFake()
	fake.apiKey = "keyid.secret"
	fallback := fake.handler()
	now := systemtest.NewDeps(t).Now()
	var native, catalogs, snapshots, refreshes atomic.Int32
	timestamp := now.UnixMilli() - 1
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/endpoints/local_gatus-self/statuses" {
			native.Add(1)
			json.NewEncoder(w).Encode(map[string]any{
				"key": "local_gatus-self", "name": "gatus-self", "group": "local",
				"results": []map[string]any{{"success": true, "status": 200, "hostname": "127.0.0.1", "timestamp": now}},
			})
			return
		}
		switch r.URL.Path {
		case "/api/trpc/integration.getKinds":
			trpc(w, []any{map[string]any{"kind": "gatus", "requiredSecrets": [][]string{{}}}})
		case "/api/trpc/widget.stats.catalog":
			if !fake.keyOK(r) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			catalogs.Add(1)
			metrics := []any{}
			for _, key := range []string{"up", "down", "unknown", "total"} {
				metrics = append(metrics, map[string]any{"key": key, "unit": "count"})
			}
			trpc(w, map[string]any{"metrics": metrics})
		case "/api/trpc/widget.stats.snapshot":
			if !fake.keyOK(r) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			snapshots.Add(1)
			trpc(w, map[string]any{"updatedAt": timestamp})
		case "/api/trpc/widget.stats.refresh":
			if !fake.keyOK(r) || inputOf(r)["force"] != true {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			refreshes.Add(1)
			timestamp++
			trpc(w, map[string]any{
				"updatedAt": timestamp, "error": false, "stale": false,
				"values": map[string]any{"up": 1, "down": 0, "unknown": 0, "total": 1},
			})
		default:
			fallback.ServeHTTP(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	secrets := allSecrets()
	from := homarrH(t, srv, secrets)
	to := targetH(t, srv, "gatus", 8080, secrets)
	to.Dir = t.TempDir()
	if err := os.WriteFile(filepath.Join(to.Dir, "config"), []byte((gatus.App{}).Files(app.RenderContext{}, nil)[0].Content), 0o600); err != nil {
		t.Fatal(err)
	}
	link := linkFor(t, "gatus")
	for _, want := range []int32{2, 3, 4} {
		if err := link.Apply(t.Context(), from, to); err != nil {
			t.Fatal(err)
		}
		// The first Apply verifies during Do and its final Check. Each
		// idempotent rerun verifies through one separate Check invocation.
		if native.Load() != want || catalogs.Load() != want || snapshots.Load() != want || refreshes.Load() != want {
			t.Fatalf("want %d verification invocations: native=%d catalogs=%d snapshots=%d refreshes=%d", want, native.Load(), catalogs.Load(), snapshots.Load(), refreshes.Load())
		}
	}
	if err := link.Remove(t.Context(), from, to); err != nil {
		t.Fatal(err)
	}
	if native.Load() != 4 || catalogs.Load() != 4 || snapshots.Load() != 4 || refreshes.Load() != 4 {
		t.Fatal("removal queried native data or Stats")
	}
}
