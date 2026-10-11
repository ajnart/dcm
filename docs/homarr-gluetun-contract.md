# Gluetun Link boundary

This is a source-only draft of #279, stacked on the [#262 reference
contract](homarr-integration-contract.md). No Docker, browser, provider connection,
personal Project, image pull or runtime acceptance was performed.

## Control access and provider readiness

The Catalog pins Gluetun `qmcgaw/gluetun:v3.41.3`, source commit
`3d1e20c5551e9cae1f9d938dc7b7214a6987f27e`. Its existing generated
`GLUETUN_CONTROL_API_KEY` is reused, never rotated by Setup. The Project's
declared-file helper renders its mode-0600 `control-auth.toml`, mounted read-only
at `/run/secrets/control-auth` and selected by
`HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH`. Its exact grants remain:

- `GET /v1/vpn/status`
- `GET /v1/publicip/ip`
- `GET /v1/portforward`

Authentication is `apikey`, sent only through `X-API-Key`. The pinned source,
unlike the moving wiki, still has public defaults when no role is configured.
Setup verifies anonymous denial and saved-key acceptance separately from tunnel
readiness. Recognized stopped/transitional/crashed statuses are data, not
authentication failures; none counts as a healthy VPN. A running status also
needs an explicit valid public IP. Missing/empty public IP is not fabricated.

Missing provider credentials and an unready tunnel remain retryable Manual steps.
Repair control-key/authfile failures through the Project boundary; an outdated
declared file needs a separately approved repeat install and start before Setup.
No provider purchase, credential discovery, traffic rerouting, firewall change,
new capability or device authority is introduced.

## Native adapter blocker

Homarr 2.4.1 accepts exactly `[apiKey]`, `[username, password]` or `[]`.
The descriptor selects `[apiKey]` and `http://gluetun:8000`, separate from the
browser Address. Its declared native defaults are `vpn` and shared Stats
`status`/`publicIp`; no guessed identifiers, throughput, uptime or optional
geographic metric is added. These metric keys are sourced from Homarr's tagged
Stats provider, not measured data or functional proof.

Both widgets use `getSummaryAsync`, which requires VPN status, DNS status,
public IP and **`GET /v1/vpn/settings`**. Gluetun's handler serializes a copy of
the full VPN settings, including OpenVPN credentials, WireGuard private keys
and port-forwarding credentials. It is not a redacted provider-summary API.
The existing control role correctly denies it and DNS status. The descriptor's
verification deliberately stops with an actionable failure without calling this
credential-bearing API directly or indirectly through Homarr. No widget or
tile-only success is claimed.

There is a second upstream incompatibility: Gluetun omits empty geography fields,
while Homarr's schema requires eight public-IP strings. A stopped tunnel clears
the public-IP object. Do not fill missing fields or call this an auth failure.

## Remaining acceptance

The reference owner must register `gluetunTarget()` only after resolving the safe
native-summary contract. No common registry or reconciliation file was changed.
An upstream adapter change is required to avoid reading provider secrets and
accept optional public-IP metadata; widening the role is not an approved fix.
An approved provider/account configuration and a separately approved disposable
runtime phase are still needed. Native data, rendered widgets, both install
orders, late peer/retry, credential changes, restart, owned-resource removal and
reinstallation remain unproven. Exact image digests have not been resolved.

The existing Gluetun and Homarr focused tests and full local gate passed:
`gofmt -l .` was empty; build, both vet invocations, `go test ./...`, race tests
for TUI/Activity/Gluetun/Homarr, and `bash -n install.sh` succeeded. The existing
Gluetun fixture was adjusted for the new public-IP probe and Manual outcome; it
is synthetic unit coverage, not an active VPN or functional Homarr proof.

## Sources

- [Official Homarr guide](https://homarr.dev/docs/integrations/gluetun/)
- [Homarr 2.4.1 adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/gluetun/gluetun-integration.ts)
- [Homarr schemas](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/gluetun/gluetun-types.ts)
- [Homarr Stats provenance](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Gluetun control-server guide](https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/control-server.md)
- [Gluetun 3.41.3 auth routes/defaults](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/server/middlewares/auth/settings.go)
- [VPN settings handler](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/server/vpn.go)
- [Unredacted settings copy](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/vpn/state/vpn.go)
- [Optional public-IP metadata](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/models/publicip.go)
- [Disconnected public-IP clearing](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/publicip/data.go)
