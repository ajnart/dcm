# Headless media catalog review

Checked 2026-10-03 in `/tmp/auto-stack-env-transition`. Scope: 19 existing
recipe/adapter pairs. Reused [existing media evidence](media-existing.md),
[Tracearr evidence](media-missing.md), and app-local pinned bootstrap notes.
This pass changes no image pins, Compose topology, runtime state, external
accounts, downloads, indexers, or media. No live deployment, restart or Homarr
integration acceptance is claimed.

## Concrete corrections

- **Tdarr:** each invocation previously obtained another bearer and regenerated
  `date: Date.now()` in the approved key insertion. The changing date changed
  its exact approval binding. HTTP mutation approval v2 now also binds canonical
  request headers, so changing the bearer requires fresh approval. The owner-only session store now retains a bounded bearer,
  saved-password digest and insertion date. Authenticated `verify-token` must
  still return the admin role before reuse. Only 401 clears the bearer;
  uncertain reads retain it. Key persistence, pre-send checkpoint and exact
  inventory reconciliation remain intact. An already-working owner credential
  without a first-owner checkpoint now refuses implicit adoption. Request contracts come from the
  [pinned publisher archive inspection](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/tdarr/bootstrap-source.md),
  not a guessed API. That historical image/archive inspection was reused;
  it was not downloaded or run again. Upstream's
  [authentication guide](https://docs.tdarr.io/docs/other/authentication/)
  does not establish live compatibility of this adapter.
- **Deluge:** repeated seed-password login previously refreshed the cookie
  before the approved `auth.change_password` request. HTTP mutation approval v2
  now binds that Cookie header. Retain the seed cookie
  bound to the saved replacement-password digest; verify `auth.check_session`
  before reuse. Only an explicit false clears it. The freshly rechecked
  [2.2.0 source](https://github.com/deluge-torrent/deluge/blob/deluge-2.2.0/deluge/ui/web/auth.py)
  generates random sessions on login, returns boolean true despite its stale
  login docstring, and accepts old/new password arguments. Current
  [Web API documentation](https://deluge.readthedocs.io/en/latest/modules/deluge.ui.web.html)
  was also fetched through Context7. Rotation remains checkpointed once;
  saved-password success and seed-password rejection remain required.
- **Jellyfin:** repeated password login created unnecessary transient sessions
  before key creation; HTTP mutation approval v2 now binds Authorization
  headers. Retain the bounded bearer, exact administrator ID and
  saved-password digest privately; verify `GET /Users/Me` and admin policy
  before reuse. Only 401 clears it. The freshly rechecked pinned
  [UserController](https://github.com/jellyfin/jellyfin/blob/v12.1/Jellyfin.Api/Controllers/UserController.cs)
  defines authenticated `/Users/Me`. Existing one-time startup/key checkpoints,
  label inventory and API-key protected readback remain unchanged.
- **NZBGet:** a successful authenticated version response alone did not prove
  RPC authentication enforcement. Require anonymous version RPC to return
  401, then validate the authenticated response's exact request ID as well as
  version/error. The freshly rechecked official
  [RPC reference](https://nzbget.com/documentation/api/) documents HTTP Basic
  authentication and separate control/restricted/add credentials. Provider
  credentials and download storage are still unconfigured.
- **qBittorrent:** analogous session-bound deferred approvals were reported to
  the shared transport/media owner, who owns the separate correction. This
  audit does not modify or certify that concurrent change.

## Per-application evidence boundary

“Prior” below means the pinned evidence already recorded in the linked prior
audits was reused, not independently refreshed for every upstream in this pass.
Every row has a recipe and adapter; that fact is not live acceptance.

| App | Implemented account/control credential | Evidence and remaining boundary |
| --- | --- | --- |
| Sonarr | Owned private `config.xml` key, checkpointed Forms policy/password, optional root | Prior pinned host-controller evidence; private XML route preserved. No new Arr write or live test. |
| Radarr | Owned XML key, Forms owner, optional exact movie root | Prior source/fixture evidence; private XML route preserved. Profiles, downloader wiring and live acceptance remain separate. |
| Prowlarr | Owned XML key, Forms owner and authenticated UI readback | Prior pinned source/fixture evidence; no indexer selected or tested. |
| Lidarr | Owned XML key, Forms owner and credential-path replay checks | Prior source/build evidence; no music root or downloader configured. |
| qBittorrent | Current-start temporary password, saved admin rotation, durable key, optional categories | Prior source/fixtures; deferred-session issue delegated. No torrents or VPN acceptance. |
| SABnzbd | Owned full INI key, checkpointed username/password, saved login and path readback | Prior 5.1.3 source and narrow INI/safety fixture; full first-run transport/live proof still absent. |
| NZBGet | Environment-seeded admin/password, read-only Basic RPC | This pass adds synthetic anonymous-denial and mismatched-ID rejection; provider/path acceptance missing. No durable API key claimed. |
| Bazarr | UI-injected key, checkpointed Basic owner and readback | Prior 1.6.0 source/build evidence; injected UI format, provider/Arr links and live acceptance pending. |
| Seerr | Verified Jellyfin peer owner, one-time provider login, persistent main API key | Prior 3.5.0 source/fixtures; lost login without captured key stops rather than repeats creation. Final initialization and Arr links remain separate. |
| Jellyfin | One-time startup owner/wizard, labeled persistent key, optional libraries | This pass fixes deferred-session reuse and extends affected synthetic fixture. Playback/restart/Homarr pending. |
| Plex | Owner-supplied external claim, owned Preferences XML token and machine identity | Prior app-local claim/image evidence only; Plex account/claim authority required. No local password or invented first account. |
| Navidrome | One-time first admin and fresh saved-password login | Prior 0.64.0 source/build; no durable API key or native Homarr integration invented. |
| Audiobookshelf | One-time root, privately saved durable root-owned API key | Prior 2.37.0 source and real-transport deferred fixture; existing stable session solution reused as pattern. Lost one-time key response without saved secret stops. |
| slskd | Environment-seeded Web owner/key, login token and key session readback | Prior pinned source/build; Soulseek identity, shares/search/transfers remain outside bootstrap. |
| Transmission | Seeded password file, denied anonymous RPC, Basic/CSRF session readback | Prior 4.1.3 RPC evidence/build; transfer/storage and VPN acceptance absent. |
| Deluge | Seed-password proof, one-time rotation, saved password and seed rejection | This pass adds synthetic stable deferred cookie, uncertainty retention and no-repeat replay proof. Daemon connectivity absent. |
| Tdarr | First-owner checkpoint, saved private key before one-time insert, independent key inventory | This pass adds synthetic stable bearer/date approval and 401/uncertainty behavior. Role is the pinned frontend identity contract; node/API listener and restart remain untested. |
| Tracearr | First owner with reviewed email, saved stable bearer, persistent public key | Prior 2.6.0 source, mock and real-transport deferred fixtures; no change. Server enrollment/restart/Homarr pending. |
| aria2 | Generated private RPC token, unauthorized RPC/version/options readback | Prior manifest/publisher source evidence; no username account exists. Token is the control credential; no transfer/session/VPN acceptance. |

Additional primary pointers retained from prior evidence: [Sonarr host controller](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/Config/HostConfigController.cs),
[Bazarr settings](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/system/settings.py),
[Navidrome auth](https://github.com/navidrome/navidrome/blob/v0.64.0/server/auth.go),
[Audiobookshelf key controller](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/controllers/ApiKeyController.js),
[slskd session controller](https://github.com/slskd/slskd/blob/0.26.0/src/slskd/Core/API/Controllers/SessionController.cs),
[Transmission RPC](https://github.com/transmission/transmission/blob/4.1.3/docs/rpc-spec.md),
[Seerr API](https://github.com/seerr-team/seerr/blob/v3.5.0/seerr-api.yml),
[Tracearr setup](https://github.com/connorgallopo/Tracearr/blob/v2.6.0/apps/server/src/routes/setup.ts),
and [aria2 RPC manual](https://aria2.github.io/manual/en/html/aria2c.html).

## Focused checks

- Bun builds passed for changed Tdarr, Deluge, Jellyfin and NZBGet adapters.
- `packages/cli/tests/media-session-replay.test.ts` passed: identical declined
  Tdarr/Deluge mutation requests across invocations, one successful owner/seed session login,
  uncertainty retention, Tdarr definitive 401 clearing, approved request reuse,
  no repeated Deluge rotation, NZBGet anonymous rejection and exact response ID.
- `packages/cli/tests/jellyfin-setup.test.ts` passed, including two identical
  deferred key requests with only one password login before approval.
- `packages/cli/tests/media-transport-replay.test.ts` passed against synthetic
  loopback APIs using actual `createSetupTransportFacilities`, fresh facilities
  per invocation and owner-only files. For all three adapters it proves stable
  real approval tokens before the deferred write, session retention on 503,
  clearing on definitive rejection, renewed login/readback, approval replay,
  and one-time-write reconciliation after an HTTP 500 with the write committed.
  Unchanged cached sessions retain identical HTTP v2 approval tokens; a renewed
  verified session produces a different exact header-bound write approval.

The first real-transport run exposed that the older HTTP v1 fingerprint excluded
authorization headers. The shared owner subsequently introduced canonical
header hashing in HTTP v2; the final focused rerun above verifies that contract.

These are synthetic APIs with adapter/real-transport checks, not fresh-image,
API-server, restart or Homarr proofs. No broad suite or release/install gate ran.
No shared-engine primitive was added; existing owner-only session storage suffices.
