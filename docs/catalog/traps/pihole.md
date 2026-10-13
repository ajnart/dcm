# Pi-hole traps

Source status, 13 October 2026 (before this docs update):
`3b22873d6da5c7034d1c4be997433f500e7cee39`.
The descriptor is normalized to the Stats SDK and registered in `internal/apps/homarr/targets.go`. This establishes source
wiring only; native/rendered data, both installation orders and lifecycle
acceptance remain unproved. Earlier dated evidence retains its original scope.

## Pitfalls

- The private admin recipe does not publish DNS port 53 or provide LAN DNS service.
- Port 53 and system resolver conflicts can disrupt the entire LAN.
- The Go CLI's `--set pihole.dns-port=PORT` changes only the TCP/UDP host publication; container DNS remains on 53. The default remains 53, which ordinary LAN DNS clients expect.

## Security

- Keep administration private and confirm DNS/DHCP ownership before publishing network ports.

## Homarr Link (#292)

The Catalog image `pihole/pihole:2026.09.0` includes FTL v6.7.1. This
implementation follows that v6 API and Homarr v2.4.1, source
`ebbd4876d25a51151444a009ab596e1154d62880`; it does not support a v5
API token or an unauthenticated fallback. The v6 `/api/info/login` response
must explicitly report an operational DNS server. Update-metadata files are
not an authentication prerequisite.

Setup verifies the Admin login, generates a dedicated application password
only when Pi-hole's single application-password slot is empty, and stores its
password and ownership hash through the Project helpers as
`PIHOLE_HOMARR_APP_PASSWORD` and `PIHOLE_HOMARR_APP_PASSWORD_HASH`.
`GET /api/auth/app` only generates a suggestion; activation requires
`PATCH /api/config` with only `config.webserver.api.app_pwhash`. Activation
invalidates current API sessions, not DNS queries or blocking rules.

Valid credentials are reused. An existing unowned slot, incomplete Project
record or enabled `app_sudo` is not adopted, rotated or changed automatically.
Restore an owned record through the Project secret boundary before retrying
`self-host setup pihole`. If activation was interrupted, apply only its saved
hash after confirming the slot is still empty. Never clear a password used by
another application. An existing two-factor Admin login is an explicit Manual
step: unattended TOTP acquisition is not implemented and 2FA is not disabled.

Verification creates a fresh application-password session with
`POST /api/auth`, sends its SID in `X-FTL-SID`, verifies the current session's
`app=true`, `cli=false`, valid state and matching ownership hash, and requires
`app_sudo=false`. It reads `/api/stats/summary` and `/api/dns/blocking` and
closes only its own session. Errors do not include response bodies, passwords,
hashes or SIDs. This is Pi-hole's least-privilege application-password mode,
**not a fully read-only credential**: it forbids configuration changes but
upstream still permits other actions, including DNS controls. This Link does
not expose controls or run those actions.

The peer descriptor `piholeTarget()` supplies the `piHole` integration using
`http://pihole:80`, separately from the browser Address. Homarr's `apiKey`
field carries the application password, not the Admin password or a v5 key.
Its preflight is read-only and runs before Homarr mutations. Defaults are
`dnsHoleSummary` with a grid layout and shared Stats entries:

| Metric key                  | Unit            |
| --------------------------- | --------------- |
| `dnsQueriesToday`           | count           |
| `adsBlockedToday`           | count           |
| `adsBlockedTodayPercentage` | percent (0–100) |
| `domainsBeingBlocked`       | count           |

Native verification retains the scoped application-session probe and validates
`widget.dnsHole.summary` for the owned integration. The shared Stats SDK reads
the catalog and prior snapshot, then forces exactly one `widget.stats.refresh`
per verification invocation. `verifyPiholeStats` checks that same sample's exact
units, integral counts, percentage range and blocked/query relationship, and
retains the timestamp requirement at or after this attempt. The central guard
rejects failed, stale or non-advancing refreshes. Native and refreshed Stats
values may change between requests and are not compared for equality. Explicit zeros and enabled/disabled blocking are valid;
missing/null fields, negative counts, body errors, rejected sessions and
unavailable data are not empty datasets. Shared Stats ownership and removal
follow the [reference contract](../../homarr-integration-contract.md).

### Verification boundary

Existing Pi-hole Setup/install fixtures model generation, activation,
application-session metadata, permissions and authenticated zero statistics.
Descriptor HTTP fixtures use the shared `statsFixture` through `verifyData`:
explicit zeros and independently changing native/Stats values pass; negative
or fractional counts, invalid percentages, inconsistent blocked counts, wrong
units, missing/null fields, a timestamp predating the attempt and no-op refresh
fail. Scope and missing native-data failures stop before Stats acquisition.
Only focused App/Homarr tests and package build/vet/format/diff checks were run
for this SDK migration; the shared registry and common implementation are unchanged.

This is **source and fixture evidence, not live functional acceptance**.
The registry owner has added `piholeTarget()` to `targets()`. No provider DNS
traffic, upstream-resolver changes, Docker runtime, installer or browser was
used here. Real image digests, native Homarr execution, a nonzero container-local
DNS fixture, rendered widgets, installation orders, late-peer readiness,
restart, credential recovery, removal/reinstallation and preservation of user
resources remain for the parent's approved isolated runtime batch. Do not use
the person's DNS settings or live blocking rules for that proof.

Sources:

- [Pi-hole Docker release 2026.09.0](https://github.com/pi-hole/docker-pi-hole/releases/tag/2026.09.0)
- [FTL v6.7.1 authentication API](https://github.com/pi-hole/FTL/blob/v6.7.1/src/api/docs/content/specs/auth.yaml)
- [FTL application-password generation](https://github.com/pi-hole/FTL/blob/v6.7.1/src/api/2fa.c)
- [FTL application-password permissions](https://github.com/pi-hole/FTL/blob/v6.7.1/src/config/config.c)
- [FTL configuration access enforcement](https://github.com/pi-hole/FTL/blob/v6.7.1/src/api/config.c)
- [Homarr Pi-hole guide](https://homarr.dev/docs/integrations/pi-hole/)
- [Homarr v2.4.1 Pi-hole version detection](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/pi-hole/pi-hole-integration-factory.ts)
- [Homarr v2.4.1 Pi-hole v6 adapter](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/pi-hole/v6/pi-hole-integration-v6.ts)
- [Homarr DNS Hole queries](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/api/src/router/widgets/dns-hole.ts)
- [Homarr Stats metric keys and units](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/integrations/src/stats/existing.ts)
- [Homarr native Stats refresh](https://github.com/homarr-labs/homarr/blob/v2.4.1/packages/request-handler/src/stats.ts)

SDK migration source checked read-only at the resolved OCI revision
`3d4150e59f600876b7e308f857b2f21572b75348`:
[Stats mapping](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts),
[Pi-hole v6 adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/pi-hole/v6/pi-hole-integration-v6.ts).
