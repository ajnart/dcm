# Plex traps

## Pitfalls

- Features and account requirements vary by subscription and release.
- The image ignores PLEX_CLAIM after the server is already logged in, so retries must inspect existing ownership before changing claim state.
- The upstream bootstrap writes /.firstRunComplete even when claim exchange fails. An expired or invalid first-run claim requires explicit inspection and reviewed recovery; restarting or rerunning extraction does not automatically retry claiming.
- The unauthenticated /identity endpoint reports claimed status and machine identity, not the owning Plex account; a local HTTP 200 or claimed=true is insufficient acceptance. The owner must verify the server in their Plex account before any claim of first-run completion.

## Security

- Treat the Plex claim token and resulting server token as private account credentials.
- Keep the server port private until claim ownership is verified; remote access and discovery ports need separate review.
- Do not put PLEX_CLAIM in catalog data, a generated Compose file, or Docker command arguments. Use the upstream bootstrap's PLEX_CLAIM_FILE with an owner-issued private token; a generated password cannot replace the account-bound claim token.
- Never enable DEBUG: the upstream bootstrap's shell tracing can expose claim and server tokens.

## Setup and Homarr credential

Plex Setup reuses a verified `PLEX_API_KEY` and `PLEX_SERVER_ID` from the
Project secret boundary. When either is missing or the token is rejected,
Setup selects only `PlexOnlineToken` and `ProcessedMachineIdentifier` with
the existing container helper, compares the latter with fresh `/identity`,
and verifies authenticated native data before saving. No full preferences
file, browser token store, account login or database injection is used.
A changed saved machine identifier remains Manual pending ownership review.
The temporary `claim-...` credential is never accepted as a Homarr API key.

The supported authority is the owned server's administrator-capable token:
Homarr's connection test requires `/prefs`, and Plex documents
`/status/sessions` as administrator-only. This is not a dedicated scoped,
read-only token. This Link performs read-only server requests, but the token
has wider authority; keep both the Project and Homarr private. No Plex Pass
purchase, paid feature or externally reachable server is implied.

Setup waits for `/identity` through its existing bounded readiness step before
deciding whether a claim token is needed. A delayed server stays in readiness
recovery; it does not request a new claim token. An unclaimed server or missing
claim prerequisite stays Manual. A server already claimed needs no new claim
token. Claim exchange belongs to the official image's first-run bootstrap, not retry Setup; that bootstrap ignores
new claims once logged in and writes its first-run marker even on failure.
Inspect an expired claim before any separately approved reclaim.

Local API observations do not establish the owning external account. Setup
keeps a separate Manual `account-ownership` step until the person verifies
the intended server in their own Plex account and records its actual
`/identity` machine identifier:

```text
self-host install plex --set plex.verified_server_id=<verified identifier>
self-host setup plex
```

The identifier is non-secret; never substitute a token in that command.
This uses the existing approved install/input boundary because `setup` has
no input-changing flags. Existing claim inputs are retained privately.
This recorded confirmation is a person assertion, not account API proof.

## Native Homarr contract and evidence limits

`plexTarget()` uses `http://plex:32400` internally and the separately resolved
browser Address. Its read-only preflight requires verified Plex Setup before
any Homarr mutation. Defaults are `mediaServer` (all playback states),
`mediaReleases`, and shared Stats `sessions` (playback session count).
No user, album or library identifier is invented. Homarr discovers show
library keys from Plex; releases are limited to 100 upstream entries, with
up to 50 recent episodes per show library. No premium widget is enabled.

Checks require explicit native library/session/release container sizes,
reject anonymous library access, validate present native identifiers, and
accept authenticated explicit zeros. Through the returned Homarr integration
ID, verification checks stream and release responses for missing fields or
source errors, then the shared SDK reads the Stats catalog and forces one
read-only refresh.
The pure `verifyPlexStats` callback requires `count` units and a finite, integral,
nonnegative `sessions` value from that same advancing sample, with its timestamp
at or after request start. Counts are not compared with separately cached
streams. An empty stream list is not playback proof.
Homarr's release adapter can skip failing per-library episode requests or
items without images; successful release queries do not prove completeness.
Its stream/release query responses can be cached; the Stats refresh timestamp
is checked separately and fresh direct Plex reads guard authentication.

Source inspection on 2026-10-11 compared Homarr image source
`3d4150e59f600876b7e308f857b2f21572b75348` with reference baseline
`ebbd4876d25a51151444a009ab596e1154d62880`: Plex adapter/credentials,
widget mapping/options, native routers, middleware, and Stats provider and
refresh paths have no differences. Common version and ownership checks stay
with #262. `targets.go` registration is reference-owner work; this peer
descriptor is not yet a registered Link on its own branch.

The targeted official image is `plexinc/pms-docker:1.43.4.10903-e5521bd8c`.
Docker Hub reported manifest-list digest
`sha256:e0ab27395614a8e1a4fdf84c6bc60ac664915cfdde70c52d030c7728a1c48e14`
and arm64 manifest
`sha256:19a24b6ca20907f8473ba52e9c4d840313c8490a35dbf6c8464c987d684e0e2e`.
Read-only inspection of the public image's 4,334-byte bootstrap layer found
`40-plex-first-run` byte-identical to official source at
`d6d268472090c5620f9c505cdb20be6a86d37f5b`, SHA-256
`acfa3948cceba9d858e85c498298aeb3e6b5d44296b0c45d265fc9f936cfe63a`.
The image revision label `c38cacc72933145b2809ebd1a91c3c91f61672ac`
was not publicly retrievable in that repository; it is not substituted as
verified public source. These are registry/source observations, not runtime
image compatibility or an exercised claim.

Only existing source/fake tests and the repository local gate are approved
here. No Docker, browser, real media, playback, scan or external account
connection was run. Native rendering, meaningful owned-media output,
installation orders, restart/credential-change and removal/reinstallation
lifecycle remain unproved. Keep #294 and its PR open/draft until those pass
after registry assembly and the reference ownership fix is frozen.

Sources:

- [Official image bootstrap](https://github.com/plexinc/pms-docker/blob/d6d268472090c5620f9c505cdb20be6a86d37f5b/root/etc/cont-init.d/40-plex-first-run)
- [Official image tag](https://hub.docker.com/v2/repositories/plexinc/pms-docker/tags/1.43.4.10903-e5521bd8c)
- [Official Plex API](https://developer.plex.tv/pms/)
- [Official authentication guidance](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)
- [Homarr Plex guide](https://homarr.dev/docs/integrations/plex/)
- [Homarr Plex adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/plex/plex-integration.ts)
- [Homarr Stats metrics](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts)
- [Homarr widget mapping](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/definitions/src/widget-integration-map.ts)
- [Homarr media streams query](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/media-server.ts)
- [Homarr media releases query](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/media-release-result.ts)
- [Homarr Stats refresh](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/request-handler/src/stats.ts)
