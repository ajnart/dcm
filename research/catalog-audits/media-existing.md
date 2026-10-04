# Existing media applications: source and acceptance audit

Checked 2026-10-03 in the environment-transition worktree. All 17 entries have
pinned Compose recipes and headless adapters. This audit ran no Docker, download,
indexer, provider, real-media, browser, or Homarr mutation. A successful build,
mock response, container start, or HTTP 200 is not fresh-instance acceptance.

`M` means a manually invoked existing synthetic fixture passed; `B` means only
the adapter's focused Bun build passed; `M*` is the focused Audiobookshelf
synthetic server with real private transport and deferred approval. Fresh/replay/restart columns below describe evidence produced
by this audit, not historical deployments on another owner. All remain pending.
The installed Bun is 1.3.14; the Bun 1.4.0+ release/install gate was not run.

| App / pinned version | Implemented bootstrap and durable credentials | Focused | Fresh | Live replay | Restart | Homarr proof still missing |
| --- | --- | --- | --- | --- | --- | --- |
| Sonarr 4.0.19.2979 | Exact owned `config.xml` key; API host GET/PUT/GET; saved Forms login; optional exact root folder | M | pending | pending | pending | Saved key integration authentication and widget readback |
| Radarr 6.4.4.10685 | Owned XML key; Forms policy/login; checkpointed optional movie root | M | pending | pending | pending | Saved key integration authentication and widget readback |
| Prowlarr 2.6.5.5623 | Owned XML key; API Forms policy; anonymous redirect and authenticated UI session readback | M | pending | pending | pending | Integration/widget support must be verified separately; no indexer selected |
| qBittorrent 5.2.3 | Current-start temporary password; saved admin rotation; read/create private API key; optional selected Arr categories | M | pending | pending | pending | API-key integration, correct Host authority, paths, Arr client verification; no torrents or VPN proof |
| SABnzbd 5.1.3 | Narrow owned INI full key; setup-safety inspection; checkpointed username/password; login and path API readback | M (INI/safety only) | pending | pending | pending | Full first-run API fixture, saved key integration, provider/storage acceptance |
| Bazarr 1.6.0 | Fresh UI-injected key; checkpointed Basic auth; API settings and UI auth checks | B | pending | pending | pending | Saved key integration, Arr connection readback; no subtitle providers selected |
| Lidarr 3.1.0.4875 | Owned XML key; API Forms policy; saved login; replay credential-path mismatch now refused | B + narrow temporary mismatch mock | pending | pending | pending | Saved key integration/widget; roots/downloader remain unconfigured |
| Navidrome 0.64.0 | Checkpointed `/auth/createAdmin`; fresh `/auth/login` verifies exact admin; no durable API key claimed | B | pending | pending | pending | Only any separately declared tile; no invented dedicated integration |
| Jellyfin 12.1.20260915-010956 | Checkpointed startup user/admin/wizard; privately saved named API key; optional libraries and readback | M | pending | pending | pending | Saved key integration, exact library visibility and approved playback |
| Seerr 3.5.0 | Exact selected Jellyfin peer owner; checkpointed provider login; durable main API key; optional library synchronization | M | pending | pending | pending | Saved key integration; final initialization and Arr service setup remain separate |
| Plex 1.43.4.10903-e5521bd8c | Owner claim file; exact vendor XML token extraction; claimed machine match; denied anonymous library read | B | owner token required | pending | pending | Intended Plex account ownership, saved token integration, approved library/playback |
| Audiobookshelf 2.37.0 | Checkpointed first root; fresh login; new durable root-owned API key with inventory and independent `/api/me` readback | M* | pending | pending | pending | Saved durable key integration/widget; no audiobook/podcast library created |
| slskd 0.26.0.65534-e3d377d4 | Private env-seeded Web owner/key; enabled-auth check; login JWT and API-key session readback | B | pending | pending | pending | Saved key integration; no Soulseek identity, share, search, or transfer approved |
| Deluge 2.2.0-ls381 | Prove seed; checkpointed password rotation; reject seed; saved password login with session cookie | B | pending | pending | pending | Web-password integration and daemon connectivity are independent; no torrents |
| Transmission 4.1.3-r0 | Saved password file; deny anonymous RPC; Basic auth + CSRF token; pinned JSON-RPC session version | B | pending | pending | pending | RPC credential integration and storage; peer/VPN ports remain unapproved |
| NZBGet 26.3 | Private env-seeded admin; Basic-authenticated version RPC | B | pending | pending | pending | Username/password integration; provider/download-path and denial checks remain missing |
| Tdarr 2.92.01 | Checkpointed first admin; admin-role token readback; private key persisted before exact inventory insertion | B | pending | pending | pending | API-key integration on correct server/API listener, internal node, persistence; no media/transcodes |

## Corrections and primary-source checks

- Audiobookshelf previously verified only the root login and created no durable
  Homarr key. Its pinned [key controller](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/controllers/ApiKeyController.js)
  returns a secret only when creating the key. The adapter now checks for a
  conflicting key name, checkpoints before one creation, saves the returned key
  privately, reads its active owner metadata, and verifies the exact root through
  [GET `/api/me`](https://github.com/advplyr/audiobookshelf/blob/v2.37.0/server/controllers/MeController.js).
  A lost creation response without a saved key stops instead of repeating POST.
  The focused real-transport fixture covers deferred approval across invocations,
  fresh synthetic setup, replay, and lost-response no-repeat. The adapter saves
  only a bounded bearer, exact root ID, and password digest in its owner-only
  session store after `/api/me` owner readback. Reuse retains the same bearer;
  only a definitive 401 clears it and requires a separately approved login on
  the next invocation. A 403, 500, or unknown outcome preserves it. This is not
  image or live API proof. Password validation now precedes `/init`.
- Lidarr completed replay previously skipped credential-path comparison when its
  checkpoint was already `forms-login-verified`. It now rejects that mismatch.
- Sonarr uses the owned XML only for its key. Its pinned
  [host controller](https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/Config/HostConfigController.cs)
  combines config and user state, returns Accepted on PUT, and requires the API
  policy readback. There is no guessed HTML onboarding flow.
- Bazarr's pinned [settings endpoint](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/api/system/settings.py)
  accepts settings form fields and returns 204. Its
  [configuration](https://github.com/morpheus65535/bazarr/blob/v1.6.0/bazarr/app/config.py)
  has no initial auth and hashes a changed password. Live injected-UI format
  remains unproven.
- Navidrome's pinned [auth implementation](https://github.com/navidrome/navidrome/blob/v0.64.0/server/auth.go)
  refuses a second first-admin and responds with the same admin/token payload as
  login. A short-lived token is not reported as a durable key.
- slskd's pinned [session controller](https://github.com/slskd/slskd/blob/0.26.0/src/slskd/Core/API/Controllers/SessionController.cs)
  and [token response](https://github.com/slskd/slskd/blob/0.26.0/src/slskd/Core/API/DTO/TokenResponse.cs)
  match the login fields and enabled/session checks. Soulseek credentials are
  separate from the Web administrator.
- Deluge's pinned [auth source](https://github.com/deluge-torrent/deluge/blob/deluge-2.2.0/deluge/ui/web/auth.py)
  actually returns `true` with a cookie, despite its stale session-ID return
  docstring. Its rotation argument order is old password, new password.
- Transmission's pinned [RPC specification](https://github.com/transmission/transmission/blob/4.1.3/docs/rpc-spec.md)
  matches JSON-RPC 2.0 `session_get`, Basic authentication, and the 409 CSRF retry.
- Plex and Tdarr have adjacent `BOOTSTRAP.md` / `bootstrap-source.md` records
  of exact image/source inspection. Those historical records were read, not
  refreshed or promoted to live acceptance here. Remaining recipes were checked
  against their local pinned source declarations and adapter routes; this audit
  does not claim every publisher tag or source was independently re-resolved.

## Next isolated Docker batch: review only

Proposed owner root `/tmp/selfhost-media-audit-batch-20261003`, Compose project
`selfhost-media-audit-20261003`; inspect both for pre-existing ownership first.
No resources have been created. Resolve each exact tag to its architecture digest
and present the generated shared plan's approval before pull/apply/setup/restart.
If a name, port, or owner already exists, stop and re-plan; do not adopt it.

| Service | Exact recipe image tag | Private host TCP -> container TCP | Fresh persistent config volume |
| --- | --- | --- | --- |
| Sonarr | `lscr.io/linuxserver/sonarr:version-4.0.19.2979` | `127.0.0.1:18989` -> `8989` | `selfhost-media-audit-20261003_sonarr_config` |
| Radarr | `lscr.io/linuxserver/radarr:version-6.4.4.10685` | `127.0.0.1:17878` -> `7878` | `selfhost-media-audit-20261003_radarr_config` |
| Prowlarr | `lscr.io/linuxserver/prowlarr:version-2.6.5.5623` | `127.0.0.1:19696` -> `9696` | `selfhost-media-audit-20261003_prowlarr_config` |
| Lidarr | `lscr.io/linuxserver/lidarr:version-3.1.0.4875` | `127.0.0.1:18686` -> `8686` | `selfhost-media-audit-20261003_lidarr_config` |
| Bazarr | `lscr.io/linuxserver/bazarr:version-v1.6.0` | `127.0.0.1:16767` -> `6767` | `selfhost-media-audit-20261003_bazarr_config` |

The compiler-generated plan is authoritative for actual resource names; reject
different names until explicitly reviewed. Only one project-owned bridge network
is permitted. No host network, socket mount, devices, privileged mode, added
capabilities, external Docker network edit, public bind, or peer ports.

Sonarr/Radarr/Lidarr/Bazarr share only the new empty owner path
`/tmp/selfhost-media-audit-batch-20261003/data` -> `/data` (read-write), with explicit
`media-data` ownership. This is disposable empty test storage, not a household
library. Select the freshly inspected non-root host UID/GID and timezone rather
than guessing them. Password/key files stay inside the private owner root; reports
contain only paths. No additional download clients, indexers, subtitle providers,
media requests, or transfers are configured.

Approval must bind exact digests, ports, generated volume/network names, storage,
UID/GID, and the setup writes above. Acceptance then requires each fresh admin
login/key readback, same-owner replay with no additional writes, and a scoped
restart followed by fresh credential readback. Failed or uncertain writes are
inspected through checkpoints, never blindly replayed. Homarr connection proof
requires its own exact owner/network plan and saved-key readback; this five-app
batch does not silently attach to an existing dashboard. Keep the fresh volumes
for restart verification; destructive cleanup requires separately reviewed exact
targets. Later batches can group servers (Jellyfin/Seerr/Navidrome/Audiobookshelf)
and clients (qBittorrent/SABnzbd/Deluge/Transmission/NZBGet). Plex needs an owner
claim; slskd and Tdarr need their additional application boundaries reviewed.

## Focused commands run

All 17 `setup.ts` files built individually with `bun build <file> --target=bun
--outfile=/dev/null`. Existing assertion scripts were manually invoked with Bun:
`sonarr-setup`, `radarr-setup`, `prowlarr-shared-setup`, `qbittorrent-categories`,
`sabnzbd-ini`, `jellyfin-setup`, and `seerr-setup` under `packages/cli/tests/`.
The temporary `/tmp/audiobookshelf-media-audit-fixture.ts` and
`/tmp/lidarr-media-audit-fixture.ts` passed before the session-reuse correction.
The durable regression is now `packages/cli/tests/audiobookshelf-setup.test.ts`;
it passed with the actual private transport and an ephemeral loopback synthetic
server outside the sandbox (the sandbox denied listening). No broad
test suite, install smoke, Docker compilation, or end-to-end test was run.
