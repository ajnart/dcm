package wud_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/apps/wud"
)

func TestEmptyInventoryReportsOnlyApprovedWatcherRegistrationFlags(t *testing.T) {
	for _, tc := range []struct{ name, watchers, flags string }{
		{"registered", `[{"type":"docker","name":"approved","configuration":{"password":"synthetic-private-value"}}]`, "docker_watchers=1 approved_registered=true"},
		{"absent", `[]`, "docker_watchers=0 approved_registered=false"},
		{"other", `[{"type":"docker","name":"synthetic-private-value"}]`, "docker_watchers=1 approved_registered=false"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeTLSFixture(t, dir, false)
			base := handler()
			transport := &handlerTransport{handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if authOK(r) && r.URL.Path == "/api/containers" {
					w.Write([]byte(`[]`))
					return
				}
				if authOK(r) && r.URL.Path == "/api/watchers" {
					w.Write([]byte(tc.watchers))
					return
				}
				base.ServeHTTP(w, r)
			})}
			err := (wud.App{}).Check(context.Background(), tlsH(t, dir, map[string]string{"WUD_DOCKER_HOST": "docker.internal"}, transport))
			if err == nil || !strings.Contains(err.Error(), tc.flags) || !strings.Contains(err.Error(), "inventory_count=0") || strings.Contains(err.Error(), "synthetic-private-value") {
				t.Fatal("missing inventory diagnostic lost registration flags or exposed configuration")
			}
		})
	}
}
