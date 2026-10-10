package paperlessngx_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/paperlessngx"
)

func TestEasyNamesComposeAllowsTheNamedOriginAndKeepsThePublishedPort(t *testing.T) {
	fragment := (paperlessngx.App{}).Compose(app.RenderContext{Port: 8000, Settings: map[string]string{"EASY_NAMES": "on", "LAN_IP": "192.168.1.20"}})
	for _, want := range []string{"PAPERLESS_URL: http://paperless-ngx.192-168-1-20.sslip.io", "${BIND_IP}:8000:8000"} {
		if !strings.Contains(fragment, want) {
			t.Fatalf("missing %q: %s", want, fragment)
		}
	}
}
