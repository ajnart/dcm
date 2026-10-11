# Immich native Homarr proof

**Partial acceptance, not a final pass.** The ownership corrections and common
Stats freshness guard are at production source
`89301aff17c86b767f5a45076881f2bb7b41db39`, reconciled through main `a6f3bd4b`.
The updated bounded run verified the Immich lifecycle and freshness guard, but
stopped on a temporary fixture's invalid legacy-board name before the retained
legacy-App cycles. Those cycles and the final post-lifecycle browser check remain
required. Subsequent documentation/screenshot changes do not change this code.

The prior complete fixture at `dce263ef822dc056558a648f8f59ea795a3e56d9` does not
verify the later ownership/freshness corrections and is not final-fix acceptance.

This covers [#262](https://github.com/ajnart/selfhost-skills/issues/262) and the
[Homarr Link contract](homarr-integration-contract.md), not other peer Apps.
The updated runtime record is `sh_12d482890001AFox72nhQmcFuy`, started at
`2026-10-11T23:24:26Z` (12 October locally), using disposable root
`immich-proof-262-1942540159` and loopback ports 53346/53347. It exited 1 after
**1m26s**, including successful owned teardown and isolated browser closure.

## Containment and method

- Disposable Compose Project and browser namespace: `i262r8`. Its initially
  inactive session's actual socket path was checked before starting:
  `/Users/ajnart/.agent-browser/namespaces/i262r8/run/i262r8.sock`, 62 bytes
  against macOS's 103-byte limit.
- Only Homarr and Immich installed, with five containers capped individually at
  1 GiB memory, 1 CPU and 512 PIDs, aggregate 5 GiB/5 CPUs. Captured scoped
  container inspection confirmed exactly five containers and all hard caps.
  Work had a 13-minute deadline, reserving 30 seconds for diagnostics and one
  minute for cleanup within the authorized 15-minute total; cancellation signals
  also canceled work and retained the owned cleanup path.
- Unique Home, media and downloads folders under the approved temporary root;
  dynamically allocated loopback ports and private Homarr boards.
- `SELF_HOST_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, development dependencies and
  `GOFLAGS=-buildvcs=false`; Go 1.26.0 on darwin/arm64, containers linux/arm64.
- Install, Setup, remove, reinstall and teardown used the production service
  boundary. The temporary wrapper only added resource caps and captured helpers;
  it forwarded `SecretDeclarer` so required startup secrets were generated.
- Fixtures used helpers for credentials and HTTP; browser login received the
  generated password through stdin, never arguments. No protected files read,
  credentials UI captured, TLS bypass or real user browser session used.
- Immich and Homarr Debug reports preceded the browser check. A separate
  agent-browser process loaded the private Home board, waited for populated
  shared Stats, took an
  accessibility snapshot and a full-page screenshot. The screenshot was reviewed
  visually, not inferred from API readback.
- Teardown removed only owned containers/networks and closed the isolated browser.
  Volumes and disposable data were kept; no prune or volume deletion.
  Afterwards, scoped container/network listings were empty and the browser
  session reported `active: false`.

The exact attempted acceptance source is retained outside the repository at
`/private/var/folders/kx/hccbvbyd6sb61s6lrr2jyt2m0000gn/T/opencode/immich-final-proof-evidence-262-9cBys7/main.go`.
Its SHA-256 is `bbfbc20fe05a039bfa3fb493637c42382e67f3e934e4dd2b820c596aae715f7a`.
The same directory's `runtime.out` has SHA-256
`ecb6c787f0d46c4f3b9d32c6b4f8f57c1ef6035442782d7e1c3ade36e579b310`.
It is not a shipped command or a CI test. To reproduce, restore it temporarily as
`tools/immich-proof/main.go` at the recorded source, with Docker and agent-browser
available and the same containment freshly approved, then run:

```bash
GOFLAGS=-buildvcs=false SELF_HOST_NO_TELEMETRY=1 DO_NOT_TRACK=1 go run ./tools/immich-proof
```

The attempted source reproduces the fixture naming failure. `main-next.go`
changes only the three legacy-board references from `Legacy fixture` to
`Legacy-fixture`; its SHA-256 is
`c53780cc26d433ab0e332816233547af80a34b29f8b6de8db7333470de6027d4`.
It passed formatting/build/vet only, **has not run**, and requires fresh runtime
authorization. The attempted source and disposable data were not overwritten.

## Controlled data and results

The library contained no photos or videos and exactly one fixture administrator.
This is authenticated empty-library acceptance, not populated-media acceptance.

| Check                   | Observed result                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential Setup        | Dedicated administrator-owned key with exactly `user.read` and `server.statistics`; authenticated identity, key metadata, statistics and user list validated.       |
| Native connection       | Authenticated `widget.immich.getServerStats` returned `userCount: 1`, `photoCount: 0`, `videoCount: 0`, `totalLibraryUsageInBytes: 0`.                              |
| Shared Stats freshness  | Genuine successful refresh with advancing `updatedAt`; an unchanged non-stale real Homarr snapshot was rejected during both Check and apply.                        |
| Negative authentication | Anonymous and wrong-key statistics requests rejected with 401/403; the scoped key also denied album access.                                                         |
| Rendered data           | Native server-stat widget and shared Stats displayed Users 1, Photos 0, Videos 0 and Storage 0 B; native storage formatted as 0.0 B.                                |
| Rerun                   | Valid key, owned integration ID and recorded widget IDs unchanged.                                                                                                  |
| Credential update       | Fixture replaced the key through the administrator API and helpers; Setup updated the same owned integration, preserving widget IDs and correct native data.        |
| User resources          | A matching unowned integration, its Home widget and its entry in shared Stats survived Setup and owned removal.                                                     |
| Ordinary removal        | Owned integration removed; user integration/widget/metric preserved; Homarr continued running.                                                                      |
| Cross-board reference   | A user widget on another private board retained its referenced integration after Immich removal; recorded Link ownership was cleared.                               |
| Reinstall               | Created a distinct owned integration; the preserved integration still returned the controlled native statistics.                                                    |
| Edited App fields       | Recorded App ID released despite edited `pingUrl`; name/icon/browser Address/ping Address unchanged, retained marker preserved through subsequent remove/reinstall. |
| Legitimate legacy tile  | An unmarked ntfy navigation App was adopted by the original-descriptor migration as expected.                                                                       |
| Legacy retained cycles  | **Not reached**: the opaque ntfy ownership record was created, but `board.createBoard` rejected the fixture board name before its cross-board binding/release.      |
| Cleanup                 | Production Project teardown succeeded; owned containers and networks removed, data kept.                                                                            |

The preserved Immich integration's linked App record remained present with
`self-host retained tile:immich`, not an owned marker. Its recorded App ID and
Link ID were cleared; reinstall created distinct owned App/integration IDs while
the preserved record kept all fixture-edited fields and continued returning
correct native statistics. Another removal/reinstall did not reclaim it or
change its cross-board widget. This verifies the edited-ping correction for
Immich, not the original-nine retained-marker regression.

For the freshness negative check, a temporary transport changed only outgoing
Stats refresh requests from `force: true` to `force: false`. Homarr itself returned
its unchanged, non-stale cached snapshot; no response or metric was fabricated.
The production guard rejected it. Restoring the normal transport produced a real
forced refresh advancing `updatedAt` from `1791761084138` to `1791761086407` with
the controlled values. Actual distributed-lock contention/queue saturation was
not induced. The opaque legacy ntfy record proves no ntfy/Sonarr native data.

Observed milestones included:

```text
INSTALL PASSED
AUTHENTICATED HOMARR API VERSION: 2.4.1
COMMON STATS REAL NO-OP REJECTION/ADVANCEMENT PASSED
ANONYMOUS/WRONG KEY/ALBUM ACCESS DENIED
RERUN STABLE KEY/INTEGRATION PASSED
CREDENTIAL UPDATE STABLE INTEGRATION/WIDGETS PASSED
MATCHING USER INTEGRATION PRESERVED ON RERUN
OWNED REMOVAL/USER INTEGRATION PRESERVATION PASSED
PRESERVED APP MARKER/RECORDED ID RELINQUISHMENT PASSED
CROSS-BOARD PRESERVATION/RELINQUISH/REINSTALL PASSED
EDITED PING/USER FIELDS/REPEATED REINSTALL-REMOVE PASSED
LEGITIMATE LEGACY MIGRATION PASSED
PROOF BLOCKED: board.createBoard HTTP 400
OWNED CLEANUP PASSED
OWNED BROWSER CLEANUP PASSED
```

The Debug report identified the board-name constraint
`/^[A-Za-z0-9-_]*$/`: `Legacy fixture` is invalid. This failure was in the
temporary harness, not a production request. No additional runtime batch ran.

## Exact image identities

All resolved images were linux/arm64. Tags remain mutable; these are the locally
resolved RepoDigests and image IDs inspected for the acceptance run.

| Image tag                                                        | RepoDigest SHA-256                                                 | Local image ID SHA-256                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `ghcr.io/homarr-labs/homarr:v2.4.1`                              | `ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd` | `c6d895d659718b05ab9cc7b936458e6f5820b5cf3f0d35318588bd1b6901ee1b` |
| `ghcr.io/immich-app/immich-server:v3.2.2`                        | `79cc1623323d5894922686d8743b4780181428f98eecbfb58ce12c41ef02d1ea` | `164cd74d962e81d75071caf31067749e14a9981e3909d198f261c3919dfaefff` |
| `ghcr.io/immich-app/immich-machine-learning:v3.2.2`              | `60dfcf266a9ef3b7376f5678e8c980d4fb61db5fc48c078fe8a326ab1535d60d` | `8d873c50e77d820ad54908303ee25d67eb8da0e001474dd387c256e11b717b43` |
| `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` | `bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23` | `1e66b73624e79cc926fe821507dd1b610989204e71c55c1335b342a6feada854` |
| `valkey/valkey:9`                                                | `418652cfb58ef879d4978c33553735d7147016032d5aefaa14c828e611eb9dfd` | `f911c6adffb5087242cc7bb39ceb7362fad4bc25bf78be072a8e6a5cfdc72f97` |

These are different provenance fields, not interchangeable versions:

| Homarr field                        | Value                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Supported authenticated API version | `2.4.1` from `info.getInfo`                                               |
| Published tag                       | `ghcr.io/homarr-labs/homarr:v2.4.1`                                       |
| Resolved image index                | `sha256:ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd` |
| linux/arm64 platform manifest       | `sha256:308feba8b9845cbdb21eb2e1b05579d49fb815bf3f0a452e58b59fcd4db8ecd2` |
| Local image/config ID               | `sha256:c6d895d659718b05ab9cc7b936458e6f5820b5cf3f0d35318588bd1b6901ee1b` |
| OCI revision label                  | `3d4150e59f600876b7e308f857b2f21572b75348`                                |
| OCI version label                   | `main`                                                                    |
| Tagged research baseline            | `ebbd4876d25a51151444a009ab596e1154d62880`                                |

Scoped image inspection read only these labels/identities. Public-source
comparisons at the OCI revision and research baseline found these 22 files
byte-identical, without assuming whole-revision equivalence or reviewing Umami's
leaf implementation:

| Prefix                          | Compared files                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/definitions/src/`     | `integration.ts`, `widget-integration-map.ts`                                                                                                                                                                                           |
| `packages/api/src/`             | `middlewares/integration.ts`, `router/app.ts`, `router/board.ts`, `router/integration/integration-router.ts`, `router/widgets/index.ts`, `router/widgets/bounded-async-queue.ts`, `router/widgets/immich.ts`, `router/widgets/stats.ts` |
| `packages/integrations/src/`    | `factory.ts`, `immich/immich-integration.ts`, `stats/existing.ts`, `stats/index.ts`, `stats/stats-integration.ts`, `stats/providers.ts`, `stats/types.ts`                                                                               |
| `packages/request-handler/src/` | `stats.ts`, `immich.ts`, `lib/integration-request-handler.ts`                                                                                                                                                                           |
| `packages/widgets/src/`         | `immich/server-stats/index.ts`                                                                                                                                                                                                          |
| `packages/validation/src/`      | `app.ts`                                                                                                                                                                                                                                |

The [resolved-image Stats handler](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/request-handler/src/stats.ts)
can return unchanged cached data on lock contention or queue timeout. Cached
values remain non-stale for one hour. The common guard therefore requires a
successful forced refresh with an advanced `updatedAt`, rather than just
`stale: false`, and every selected metric must be non-null. Nil legacy verifiers
and removal retain their previous behavior.

## Local gate and limits

At the recorded source, build, both vet runs, full Go tests, race checks for
Homarr/Immich/TUI/Activity/service, shell syntax and formatting passed. CI is not
claimed; these were local gates, without the e2e Docker build tag at runtime.

Nonempty media, album/gallery features, lost/rejected-key Manual recovery,
version migration, restore, physical LAN access and other peer Apps
were not exercised. **Required outstanding checks:** retained legacy-App release
and exclusion across two reinstall/remove cycles, and post-lifecycle browser
verification of the preserved board and final Home board. The earlier Home
render is verified, not those later browser stages. Immich has nil `preflight`:
this proves unchanged reference behavior after adding the seam, not execution
of a non-nil Frigate callback or
its trusted-HTTPS prerequisite. That live acceptance remains peer-owned.

The browser allowed only `127.0.0.1`: external App icons were blocked and the
seed weather widget is outside this acceptance scope. The unconfigured assistant
remained unavailable. Neither affects the verified native/shared Immich statistics.

## Reviewed screenshot

The reviewed screenshot is from the updated source after the key update and
before the ownership lifecycle, not a final post-lifecycle capture.
`images/immich-homarr-proof.png` SHA-256:
`a40ff000e96773df5cf0f560074f4bc9f2bae5c91d58a74aa601cc6f66ff559c`.

![Native Immich server statistics and shared Stats on the private Home board](images/immich-homarr-proof.png)
