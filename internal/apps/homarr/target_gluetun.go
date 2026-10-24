package homarr

import (
	"context"
	"errors"
	"net/netip"

	"github.com/ajnart/self-host/internal/apps/gluetun"
	"github.com/ajnart/self-host/internal/helpers"
)

const gluetunPrivacyHint = "Use audited Homarr 2.5.1 or newer 2.x for the credential-safe Gluetun summary. Older, unknown or unreadable versions remain paused before provider requests or Homarr changes. Back up Homarr before updating, retain the existing read-only control role, then retry self-host setup gluetun and self-host setup homarr."
const gluetunReadinessHint = "Gluetun's saved read-only control key and running VPN with a public IP must pass its Setup first. Confirm your provider account, country and privately supplied OpenVPN credentials, then retry self-host setup gluetun and self-host setup homarr. Keep the firewall enabled; NET_ADMIN, /dev/net/tun and a real tunnel-break fail-closed test remain separate runtime prerequisites."

func gluetunTarget() target {
	return target{
		id: "gluetun", name: "Gluetun", kind: "gluetun", internal: fixed("http://gluetun:8000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("control_api_key"))}}
		},
		widgets:   []widget{plain("vpn"), statWidget("status", "publicIp")},
		preflight: preflightGluetun,
		verify:    verifyGluetun,
		stats:     validateGluetunStats,
	}
}

func preflightGluetun(ctx context.Context, from, to *helpers.H) error {
	if err := requireCredentialSafeHomarr(ctx, from, gluetunPrivacyHint); err != nil {
		return err
	}
	if err := (gluetun.App{}).Check(ctx, to); err != nil {
		from.Info(gluetunReadinessHint)
		return helpers.ErrManual
	}
	return nil
}

func verifyGluetun(ctx context.Context, from, _ *helpers.H, integrationID string) error {
	if err := requireCredentialSafeHomarr(ctx, from, gluetunPrivacyHint); err != nil {
		return err
	}
	value, err := apiKeyProcedure(ctx, from, "widget.vpn.getSummaries", map[string]any{"integrationIds": []string{integrationID}})
	if err != nil {
		return err
	}
	results, ok := value.([]any)
	if !ok || len(results) != 1 {
		return errors.New("Homarr did not return the owned Gluetun VPN summary; retry self-host setup homarr")
	}
	result, ok := results[0].(map[string]any)
	integration, identityOK := result["integration"].(map[string]any)
	summary, summaryOK := result["summary"].(map[string]any)
	if !ok || result["error"] != nil || !identityOK || !summaryOK || integrationID == "" || stringField(integration, "id") != integrationID || stringField(integration, "kind") != "gluetun" {
		return errors.New("Homarr returned an invalid or failed owned Gluetun VPN summary; retry self-host setup homarr")
	}
	if err := validateGluetunStatusAndIP(summary["vpnStatus"], summary["publicIp"]); err != nil {
		return err
	}
	for _, key := range []string{"country", "city"} {
		if value, present := summary[key]; present {
			if _, ok := value.(string); !ok {
				return errors.New("Homarr returned malformed optional Gluetun geography; retry self-host setup homarr")
			}
		}
	}
	return nil
}

func validateGluetunStats(sample statsSample) error {
	if sample.units["status"] != "text" || sample.units["publicIp"] != "text" {
		return errors.New("Homarr returned unsupported Gluetun Stats units; retry self-host setup homarr")
	}
	// Native and Stats are independently cached samples; only validate meaning,
	// never equality with a previous native response or additional Stats reads.
	return validateGluetunStatusAndIP(sample.values["status"], sample.values["publicIp"])
}

func validateGluetunStatusAndIP(statusValue, ipValue any) error {
	status, ok := statusValue.(string)
	if !ok {
		return errors.New("Homarr returned missing Gluetun VPN status; retry self-host setup homarr")
	}
	switch status {
	case "running", "stopped", "starting", "stopping", "crashed":
	default:
		return errors.New("Homarr returned unsupported Gluetun VPN status; retry self-host setup homarr")
	}
	publicIP, ok := ipValue.(string)
	if !ok {
		return errors.New("Homarr returned missing Gluetun public IP; retry self-host setup homarr")
	}
	// The upstream schema permits an explicit empty IP while discovery is
	// unavailable, including during state transitions. It is never a fake zero.
	if publicIP == "" {
		return nil
	}
	ip, err := netip.ParseAddr(publicIP)
	if err != nil || ip.Zone() != "" || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return errors.New("Homarr returned an invalid Gluetun public IP; retry self-host setup homarr")
	}
	return nil
}
