package vaultwarden_test

import (
	"strings"
	"testing"

	"github.com/ajnart/self-host/internal/app"
	"github.com/ajnart/self-host/internal/apps/vaultwarden"
)

func TestEasyNamesComposeUsesTheNamedAddressAndKeepsTheFallbackPort(t *testing.T) {
	fragment := (vaultwarden.App{}).Compose(app.RenderContext{Port: 8222, Settings: map[string]string{"EASY_NAMES": "on", "LAN_IP": "192.168.1.20"}})
	for _, want := range []string{"DOMAIN: http://vaultwarden.192-168-1-20.sslip.io", "${BIND_IP}:8222:80"} {
		if !strings.Contains(fragment, want) {
			t.Fatalf("missing %q: %s", want, fragment)
		}
	}
}
