package homarr

import (
	"context"

	"github.com/ajnart/self-host/internal/helpers"
)

const gluetunPrivacyHint = "Homarr 2.4.1 VPN and Stats read provider credentials through GET /v1/vpn/settings and require DNS access outside the existing control grants. Keep this Link paused until an audited supported image provides a credential-safe summary and optional public-IP metadata. Do not broaden the control role or disable authentication; a local upstream patch does not clear this hold. Then retry self-host setup gluetun and self-host setup homarr."

func gluetunTarget() target {
	return target{
		id: "gluetun", name: "Gluetun", kind: "gluetun", internal: fixed("http://gluetun:8000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("control_api_key"))}}
		},
		widgets: []widget{plain("vpn"), statWidget("status", "publicIp")},
		preflight: func(_ context.Context, from, _ *helpers.H) error {
			from.Info(gluetunPrivacyHint)
			return helpers.ErrManual
		},
		verify: verifyGluetun,
	}
}

func verifyGluetun(_ context.Context, from, _ *helpers.H, _ string) error {
	from.Info(gluetunPrivacyHint)
	return helpers.ErrManual
}
