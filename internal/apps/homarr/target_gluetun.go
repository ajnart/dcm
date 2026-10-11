package homarr

import (
	"context"
	"errors"

	"github.com/ajnart/self-host/internal/apps/gluetun"
	"github.com/ajnart/self-host/internal/helpers"
)

func gluetunTarget() target {
	return target{
		id: "gluetun", name: "Gluetun", kind: "gluetun", internal: fixed("http://gluetun:8000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("control_api_key"))}}
		},
		widgets: []widget{plain("vpn"), statWidget("status", "publicIp")},
		verify:  verifyGluetun,
	}
}

func verifyGluetun(ctx context.Context, _, to *helpers.H, _ string) error {
	if err := (gluetun.App{}).Check(ctx, to); err != nil {
		return err
	}
	return errors.New("Homarr 2.4.1 VPN and Stats require GET /v1/vpn/settings, which exposes provider credentials in Gluetun 3.41.3. " +
		"This Link is blocked until an upstream credential-safe summary is supported; do not broaden the control role, disable authentication, or treat a navigation tile as success")
}
