# Gluetun Link boundary

The Gluetun leaf is source-complete for audited Homarr `2.5.1` and `2.5.2`.
The native/privacy source blocker from #332 is resolved by released upstream
[hotfix #7170](https://github.com/homarr-labs/homarr/pull/7170). Provider and VPN
runtime acceptance is deferred: no real provider connection, Docker, browser,
personal Project or tunnel-break test was performed by this leaf.

## Control access and provider readiness

The Catalog pins Gluetun `qmcgaw/gluetun:v3.41.3`, source commit
`3d1e20c5551e9cae1f9d938dc7b7214a6987f27e`. Its generated
`GLUETUN_CONTROL_API_KEY` is reused, never rotated by the Link. The Project's
mode-0600 `control-auth.toml` remains mounted read-only at
`/run/secrets/control-auth` and selected by
`HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH`. Its exact grants remain:

- `GET /v1/vpn/status`
- `GET /v1/publicip/ip`
- `GET /v1/portforward`

Authentication is `apikey`, sent only through `X-API-Key`. The pinned source
still has public defaults when no role is configured. Link preflight first
reads authenticated Homarr `info.getInfo`; exact `2.5.1` and `2.5.2` pass, while
older, unknown, malformed or unreadable versions stop as retryable Manual before
provider requests or Homarr mutation. Standalone verification repeats this gate
before the native query or Stats acquisition.

After the safe-version gate, preflight delegates to Gluetun's existing `Check`:
anonymous status must return 401, the saved key must work, and the VPN must report
`running` with a valid public IP. Missing provider credentials, control recovery
and an unready tunnel retain an actionable Manual hint. No provider purchase,
credential discovery, traffic rerouting, firewall change, new capability or
device authority is introduced. The existing NET_ADMIN and `/dev/net/tun`
approvals, provider/account configuration and recorded tunnel-break fail-closed
acceptance remain separate runtime prerequisites.

## Native and Stats contracts

The Link supplies `[apiKey]` to integration kind `gluetun` at
`http://gluetun:8000`, separate from the browser Address. Its existing selectors
remain native `vpn` and shared Stats `status`/`publicIp`. No geography, throughput,
uptime or invented selector is added.

The inspected fixed upstream adapter calls only `GET /v1/vpn/status` and
`GET /v1/publicip/ip`. It never reads `/v1/vpn/settings` or DNS status. Country,
city and other public-IP metadata are optional. Homarr `2.5.2` tag source
`7eb9a417a60d759adce5f7ac15ceb594aefad471` retains the identical fixed adapter,
schemas, native router and Stats mapping from released `2.5.1` OCI revision
`62c8513a27e9fd40ad935fac152ba1a6a84f0867`. Image/API observations belong to the
[shared contract](homarr-integration-contract.md); source equality is not real
Gluetun acceptance.

`widget.vpn.getSummaries` is requested with exactly the owned integration ID.
Verification requires exactly one result, matching integration ID and kind,
no reported error and an object summary. `vpnStatus` must be one of `running`,
`stopped`, `starting`, `stopping` or `crashed`; `publicIp` must be a string.
A nonempty IP must parse as an unscoped public unicast address. An explicit empty
IP is legitimate unavailable data, including while discovery catches up with
running status. Omitted country/city is accepted; supplied malformed or null
geography fails. A nonrunning summary is valid data, never a healthy-tunnel
claim. Preflight separately enforces the running-tunnel prerequisite.

The pure Stats callback consumes the common SDK's one catalog and one completed
forced refresh. Both selected metrics require exact unit `text` and retain the
same status/IP semantics. Missing/null selected values fail; empty IP is never
replaced by zero. Native and Stats are independently cached samples and need
not have equal volatile values. The callback performs no HTTP, catalog or Stats
reads. Common freshness rules still reject cached/no-op refreshes and malformed
or nonadvancing timestamps.

## Focused source validation and deferred acceptance

`go test ./internal/apps/homarr -run 'TestGluetun' -count=1` passed. Focused
interface fixtures cover both safe versions, unsafe/unreadable versions in
Check/apply/standalone verification, restricted control preflight, every status,
IPv4/IPv6 and legitimate empty IP, optional geography, malformed identity/data,
incorrect units and no-op refresh. The fixture rejects any request outside its
explicit route list and requires one owned Stats sample per verification.
Those synthetic checks prove client ordering and validation; the fixed upstream
source establishes its endpoint set. Neither is provider or fail-closed proof.

No common registry or reconciliation file was edited in this leaf. There is no
remaining source blocker in the audited native contract. Real native data,
rendered widgets, both install orders, late peer/retry, provider credentials,
restart, downloader namespace/IP/DNS privacy, tunnel-break recovery, owned-resource
removal and reinstallation remain deferred to an approved runtime phase with
an available provider account.

## Sources

- [Fixed Homarr adapter](https://github.com/homarr-labs/homarr/blob/7eb9a417a60d759adce5f7ac15ceb594aefad471/packages/integrations/src/gluetun/gluetun-integration.ts)
- [Fixed Homarr schemas](https://github.com/homarr-labs/homarr/blob/7eb9a417a60d759adce5f7ac15ceb594aefad471/packages/integrations/src/gluetun/gluetun-types.ts)
- [VPN result router](https://github.com/homarr-labs/homarr/blob/7eb9a417a60d759adce5f7ac15ceb594aefad471/packages/api/src/router/widgets/vpn.ts)
- [Stats metric mapping](https://github.com/homarr-labs/homarr/blob/7eb9a417a60d759adce5f7ac15ceb594aefad471/packages/integrations/src/stats/existing.ts)
- [Gluetun control-server guide](https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/control-server.md)
- [Gluetun 3.41.3 auth routes/defaults](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/server/middlewares/auth/settings.go)
- [VPN settings handler](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/server/vpn.go)
- [Unredacted settings copy](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/vpn/state/vpn.go)
- [Optional public-IP metadata](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/models/publicip.go)
- [Disconnected public-IP clearing](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/publicip/data.go)
