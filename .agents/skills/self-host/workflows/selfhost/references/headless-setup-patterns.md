# Headless first-run patterns

An app entry is `apps/<id>/{manifest.json,recipe.json,setup.ts}`. The manifest
states sourced facts, the v2 recipe declares only the reviewed Compose shape,
and `setup.ts` performs the app-specific first-run requests. The shared engine
owns private HTTP transport, generated secrets, exact-owner checks, approvals,
checkpoints, and parallel execution of independent app adapters. A recipe without
`setup.ts` is deployable but **not configured**.

| Bootstrap pattern | Recipe declaration | Minimum adapter proof |
| --- | --- | --- |
| No account | `no-account`, no password file | Read an upstream-documented private endpoint; report no username or key. |
| Environment-seeded admin | Generated password bound through a documented `*_FILE` or private `secretEnvironment` | Authenticate the saved identity and read an account-only endpoint; do not assume a running container proves login. |
| First-run HTTP owner | `manual-first-admin`, `manual-first-email`, or `manual-first-password` | Inspect the fresh state, checkpoint before the one-time write, then authenticate and read back the exact owner. |
| Seeded public administrator | `seeded-admin-rotation` | Prove the documented seed, rotate once to the saved password, reject the seed, and authenticate the replacement. Never expose the seed beyond the private boundary. |
| App-generated administrator | First-admin recipe with an unused generated password placeholder | Run a fixed, one-time upstream command that generates a password. `captureAdminPassword` privately replaces the exact owner-only file from a bounded stdout format, then authenticate the saved identity. An interrupted capture is unresolved, not permission to rerun creation. Forgejo and BookStack use this pattern. |
| Password-hash stdin | First-admin recipe with a generated password file | When upstream accepts a hash on stdin, derive its pinned hash format inside the owned container, submit it through stdin, and verify the saved password against the installed hash. Keep plaintext and hash out of argv and ordinary output. FreshRSS uses this pattern. |
| Polling protocol control | Pinned Socket.IO path and private saved origin | Only exact namespace-connect and pong frames may use `effect: "socketio-control"`. Application events still need approval; first-admin writes also need a pre-send checkpoint. Uptime Kuma uses this pattern. |
| Authenticated WebSocket command | Home Assistant's documented `/api/websocket` authentication protocol | `webSocket.request` derives the endpoint from the exact saved loopback origin, rejects redirects, authenticates privately, and sends one correlated JSON command. Only `auth/current_user` is read-only; `auth/long_lived_access_token` requires one-time approval and a saved pre-send checkpoint. Save the returned token privately and verify the same owner with it; a lost creation response is not replayable. |
| App-generated API key | Generated or owner-owned private config path | Read the exact owned container's private config, save the key once, use the authenticated API to set login, then verify login and key readback. Sonarr, Radarr, and Prowlarr use this pattern. |
| External identity | `external-first-admin` with a selected provider | Verify the selected provider's owner first; do not invent a local password. |
| Owner-issued token file | `external-secret` with one owner `privateFiles` entry bound through a documented `*_FILE` variable | Import an exact owner-only file after approval, verify the saved bytes on resume, and check the upstream service without presenting the token as a generated account or API key. |

For Sonarr v4, the fresh Forms-admin route is four HTTP calls: GET the effective
[host resource](https://raw.githubusercontent.com/Sonarr/Sonarr/v4.0.19.2979/src/Sonarr.Api.V3/Config/HostConfigResource.cs),
PUT the changed resource, GET the policy readback, then POST the saved password
to login. Read the API key from the owned `config.xml` without another HTTP
call. The [PUT response](https://raw.githubusercontent.com/Sonarr/Sonarr/v4.0.19.2979/src/Sonarr.Api.V3/Config/HostConfigController.cs)
is only Accepted, while the effective host resource also uses database-backed
settings and user state; XML alone cannot replace the two GETs. After an
attempted PUT, resume with GET and login without replaying the write.

The fast path is not a single blind POST. Every mutating request needs an exact
precondition and a before-send checkpoint; a lost response must be inspected,
not replayed. On resume, compare saved credentials and immutable recipe/owner
details with observed state. Save passwords and API keys only in the project's
owner-only, gitignored files. A short-lived login token is not a durable API key.

Generated `privateFiles.bytes` is entropy, not character count: 48 bytes encoded
as alphanumeric produce 65 characters. Use `types/private-file.ts`'s
`generatedPrivateFileLength` in exact adapter checks, and validate setup with
credentials from `prepareMultiServiceFiles`, not hand-authored fixture strings.
Resume reuses the saved file; changing a validator must not regenerate it.

## Stable setup and recovery

Keep these invariants inside the app adapter; the shared transport already owns
private session storage and request approval hashes.

- **Stable intent:** reuse the same private cookie, bearer, CSRF value, nonce and
  request timestamp while a write awaits approval. A fresh login or `Date.now()`
  changes the request hash and makes the previous approval unusable. Bind cached
  authorization to the saved password digest and verify the exact account/role.
- **Definitive expiry:** clear a cached session only on the pinned upstream's
  explicit expiry response. Preserve it after timeouts, server errors or an
  unexpected identity; stop for inspection. A renewed session requires a fresh
  write approval.
- **Capture first:** validate and save a returned durable API key before the next
  network request. Verify the saved key afterward. A failed readback resumes
  verification instead of creating another key.
- **Readback, not status:** prove the expected administrator and effective
  settings. A generic HTTP 200 or a compatibility version string is insufficient.
- **Observe attempts:** shared setup records sanitized attempted/ready/deferred/
  failed chronology, bound to its saved owner, recipe, images and executable
  setup contract. Review writes no journal. Adapter readiness and this journal
  are not functional or restart acceptance.

Use app-specific expiry and identity contracts rather than a global status-code
rule: qBittorrent's missing-session response differs from its CSRF rejection.
The catalog's focused deferred-setup fixtures exercise the real approval transport
to ensure the token from one invocation still approves the same next request.

The WebSocket helper follows [Home Assistant's authentication and result protocol](https://developers.home-assistant.io/docs/api/websocket/).
It rejects binary frames and unsolicited IDs, caps responses at 1 MiB and three
messages, and terminates within 15 seconds. The pinned
[ws client](https://github.com/websockets/ws/blob/8.21.3/doc/ws.md) disables
redirects and compression and bounds fragments before JSON decoding. Token
creation approval binds the saved owner revision, origin, command, private bearer
digest, and checkpoint. No arbitrary URL, header, subscription, or channel is
available through the setup context.

Common gaps belong in the manifest rather than an unsafe recipe:

- A browser-only wizard or an undocumented request body needs evidence from a
  pinned source or an isolated, privately recorded session before scripting.
- A password accepted only in process arguments needs an evidenced app-generated
  credential, private stdin/hash route, or upstream HTTP route. Keep plaintext
  out of `docker exec` argv. App-generated output is recoverable only if the
  owner-only file was saved; a lost output stops automatic replay.
- A bcrypt-backed config file or structured secret URL needs a typed pre-start
  derivation and proven image-user readability, not literal credentials in JSON.
  Use the typed `bcrypt-hash` env binding only when the app's pinned settings
  format reads a hash from the environment; the saved password and hash must
  match on resume.
- A Docker socket, host networking, privileged mode, or host-root mount is not a
  normal shared recipe. Escalation needs its own reviewed capability and boundary.
- A third-party claim token, domain, backup repository, or off-host store is an
  owner choice. Do not fabricate one or mark its setup complete by default.
  The owner-file input can carry an issued token, but it does not prove the
  token's remote scope or authorize a public route.

## Reusable gaps found in the Compose-only catalog

These are shared-engine work items, not reasons to add app-specific command
routers. Each still needs a pinned upstream example and an isolated first-run
and replay check before an app becomes installable.

| Shared primitive | Current examples | Required boundary |
| --- | --- | --- |
| Owner-file path expression (available) | Tailscale accepts `TS_AUTHKEY=file:/path`, not `TS_AUTHKEY_FILE` | Use the sourced `file-uri` binding for an owner-issued file; verify tailnet enrollment and the selected access target before offering a recipe. |
| Owner-file plain path (available) | AIStor `MINIO_LICENSE`; WUD Docker TLS `CAFILE`/`CERTFILE`/`KEYFILE` | Use `fileEnvironment` with `format: "file-path"`, an owner-issued file and exact listed publisher evidence. Render only `/run/secrets/<fileId>`; login bootstrap, license validity and remote Docker authority remain separate. |
| Secret-derived writable file (available) | Authelia file users database | Use the shared mutable-config hook and private Argon2id/YAML worker. Verify the retained file before login; application privileges and SSO remain separate. |
| Generated first-run capability (available) | Pangolin setup token | Declare the source-backed bootstrap-capability format separately from passwords and API keys. Read it through the actual saved-recipe validator; checkpoint before account creation. |
| Portless daemon API (available) | ZeroTier | Use `private-daemon`, save the generated native token and verify authenticated container-local responses. No dummy browser URL, host-network grant or enrollment claim. |
| VPN runtime device (available) | Gluetun, ZeroTier | Use the source-bound `tun-net-admin` declaration. Exact manifest approval and startup checks grant only `NET_ADMIN` and the TUN device; tunnel-break and peer acceptance remain separate. |
| Private authentication attempt (available) | NetBird OAuth/PKCE | Save bounded attempt material through `readSetupSession` / `writeSetupSession`; keep state, code and cookies private. Resume the exact approved exchange or start a new attempt after lost output, never replay a consumed code. |
| Owner-chosen HTTPS origin and edge | Authelia, Headscale, Passbolt, Pangolin | Bind a reviewed domain, DNS/TLS/proxy owner, and required callback/cookie URLs. A loopback port is not an HTTPS identity. |
| One-shot Compose job | Renovate, Restic, Borgmatic | `restart: "no"`, no published frontend, no automatic execution on apply, explicit scope and approval for each write-capable run, and exit/log acceptance. |
| Bounded hardware and bootstrap-log capture | Frigate | Current camera-free bootstrap privately captures the exact current-start admin block and rotates the password. Actual cameras/devices and authenticated native Homarr support remain separate requirements. |
| Host-control authority | Coolify, Portainer, Dockge | Treat SSH or Docker-management access as a separate reviewed privilege, not an ordinary app port or inferred socket grant. |

Several entries combine these primitives with owner decisions. Adding a schema
field alone must not promote an app whose actual first-admin or remote-access
path remains unverified.

Before promotion, verify the pinned image on a fresh isolated instance, replay
setup against the same saved owner, check login/key readback, and prove a scoped
restart retains credentials. Compose health and catalog validation are narrower
signals, not first-run acceptance.
