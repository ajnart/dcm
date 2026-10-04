# Isolated control-panel proof (2026-09-29)

This is one host-specific acceptance record, not a claim about every catalog app
or installation. Tests used the packaged CLI, rootless Docker, fresh isolated
project roots, exact project approvals, and no unrelated Docker resources.
Credentials stayed in owner-only files; no values or browser traces are here.

| Journey | Observed result | Limit |
| --- | --- | --- |
| New two-app project at `/tmp/selfhost-twoapp-live-20260929-pe6eDX` | Uptime Kuma and Paperless-ngx were applied as independent saved jobs. Both admin logins passed. Uptime's local self-monitor recorded an up baseline. Paperless accepted a canary document, completed OCR, and returned original bytes identical to the upload. | Other apps, hosts, backup restore, and remote access were not tested. |
| Existing project, scoped restart | Each exact app was stopped and started without deleting volumes. Paperless's saved document and original bytes persisted; Uptime's monitor recorded a fresh up heartbeat. Repeating Uptime onboarding returned `created:false` and left its credential-file digest unchanged. | The batch summary remains `acceptanceVerified:false`; direct app-specific checks are the acceptance evidence. |
| Existing Paperless token setup | An exact approved request to the pinned `/api/token/` route saved a token file as owner 1000, mode 0600, one link. Token-authenticated user identity matched the managed administrator; statistics read-back passed. A repeat plan saw `alreadyPresent:true`, and its approved create call returned `token-already-current`, `mutation:false`. Default handoff returned the password and API-token file paths without values. | Token ownership and API access are proved on this isolated instance, not every Paperless release or a native Homarr integration. Deliberate `handoff --show` is secrets-full and was not printed into this evidence. |
| Existing-project recap | `self-host status --project-root /tmp/selfhost-twoapp-live-20260929-pe6eDX --json` recognized a recorded batch, two applied jobs, and both owned projects running. After Homarr was added, the control panel derived all three active apps from saved app state without replaying an install. | Container state alone does not verify login or function. The interrupted selection did not write a separate `control-panel.json`; observed app state remained authoritative. |
| Optional Homarr added to the existing project | Homarr `ghcr.io/homarr-labs/homarr-test:v2` applied at `http://127.0.0.1:27984`; saved admin login and API key were verified. The control panel then attached Paperless and Uptime Kuma to one private `personal` board as host-local bookmarks. Independent attachment status read back both tiles and the same stack Notebook with `notebookContentVerified=true`. The password, key, and attachment-input references are owner-owned, mode 0600. Paperless's exact synthetic canary was subsequently moved to recoverable trash with its saved approval; cleanup returned `cleanupPending=false`. | These `127.0.0.1` bookmarks work only in a browser on the Docker host. No native app integration, widget data, Homarr-to-app container route, remote browser route, rendered board, or Homarr restart persistence was verified. MCP client setup was not offered in this direct-CLI onboard. |
| Optional standalone Homarr at `/tmp/selfhost-homarr-live-20260929-zyTF7R` | `ghcr.io/homarr-labs/homarr-test:v2` applied; admin login and owner-only API key passed. MCP read-only board listing found one private `personal` board. The read-only MCP profile passed native authentication/tool verification; a Codex fragment was generated but not installed. | This was a separate project, not connected to the two-app batch. Notebook, native integrations/widgets, rendered board, and Homarr restart persistence remain unverified. |

## Homarr-first new-project journey

A second isolated root, `/tmp/selfhost-homarr-first-20260929-zk6N4p`, started
with onboarded Homarr at `127.0.0.1:28084` using exactly
`ghcr.io/homarr-labs/homarr-test:v2`. Uptime Kuma at `:28085` and Paperless-ngx
at `:28086` were then applied as separate jobs in one recorded parallel batch;
only their frontends joined Homarr's approved private bridge. Docker Hub HTTP
429 prevented fresh registry resolution, so four reviewed image pins were
supplied from this host's earlier running trial. Recipe tags matched, but their
registry/platform provenance was **not freshly validated**. No indexer, media
request, external route, or unrelated project was changed.

Both saved admins passed login. Paperless's owner-only, mode-0600 API token
authenticated as the managed admin and read statistics; an approved repeat
returned `token-already-current` without rotation. A synthetic Paperless
document passed OCR and exact original-byte readback after scoped stop/start,
then moved to recoverable trash. Uptime's local-only self-monitor ID 1 recorded
a fresh UP heartbeat after its own scoped stop/start. This proves those app
checks on this project, not Internet availability or backup restore.

The private Homarr `personal` board read back two host-local app tiles and one
shared stack Notebook (`notebookContentVerified=true`). A separately approved
Kuma v2.5.5 `default` status page exposed only saved self-monitor ID 1; its
unauthenticated JSON page and heartbeat returned that monitor UP. Homarr's
native `paperlessNgx` integration/widget then read five live statistics fields;
native `uptimeKuma` integration/widget returned one live monitor. Independent
status calls and repeat plans confirmed both resource IDs and `alreadyCurrent`
without adding duplicates. After an exact, volume-preserving Homarr stop/start,
both tiles, the same Notebook, both integrations/widgets, Paperless live stats,
and the one-monitor Kuma dashboard still read back. Homarr's container health
was `unverified`; API readback, not Docker health, is this evidence.

The packaged CLI was opened in a PTY from this fresh root. It recognized three
saved active apps, showed their URLs, and its catalog picker filtered
`paperless`, toggled it off/on with Space, accepted Backspace, and reviewed
`Added: none; Retained: homarr, paperless-ngx, uptime-kuma; Removed: none`
without mutation. Its saved-project resume recap read the recorded batch and
exact app paths. One sandboxed PTY attempt could not check Docker sockets;
the elevated, exact-project PTY attempt succeeded. No browser-rendered board
or screenshot was obtained because isolated Chromium cannot launch with this
host's user-namespace policy; browser sandboxing was not disabled. The Kuma
status-page endpoints need no login, and loopback binding/private bridge do
not rule out an operator-owned proxy or tunnel. No Homarr MCP client was
installed in this project.

For a safe repeat on this host, inspect each saved app first, obtain its fresh
`approvals.down` and `approvals.up`, and use `app down` then `app up` for that
same ID and root. `down` is a scoped Compose stop, not volume removal:

```bash
self-host app status --id uptime-kuma --project-root /tmp/selfhost-twoapp-live-20260929-pe6eDX --json
self-host app status --id paperless-ngx --project-root /tmp/selfhost-twoapp-live-20260929-pe6eDX --json
```

Alternatively, run `self-host` from that root and use the control panel's
reviewed Stop/Start actions. The two-app project, its optional Homarr project,
the separate Homarr project, and the Homarr-first project were left running.
The earlier failed Paperless trial remains untouched.

No Homarr screenshots were captured. An isolated agent-browser session could
not launch Chromium because this host disallows the required user namespace;
the trial did not disable Chromium sandboxing. API readback is not visual proof.

## Fifth recipe: standalone Prowlarr

A separate fresh rootless project at
`/tmp/selfhost-prowlarr-live-20260929-keAndI` applied pinned LinuxServer
Prowlarr 2.6.5.5623 to `127.0.0.1:28187` with one project-owned `/config`
volume. Its digest was resolved from the registry for Linux/amd64 before the
exact app plan. The generated admin-password and extracted `config.xml` API-key
files were owner 1000, mode 0600, and single-link. The API read-back confirmed
required Forms auth, and the cookie-protected UI confirmed the saved admin.

An initial login verification stopped at the saved `attempted` checkpoint
because this image redirects to an absolute same-origin `/login` URL. The
strict parser was corrected; the approved retry verified the existing host
settings and login without a second settings PUT. A further approved repeat
returned `mutation:false`. After an exact, volume-preserving stop/start,
admin/API-key verification again returned `mutation:false`. The packaged
CLI's read-only `app login-check` then returned `admin-and-api-verified`,
`loginVerified:true`, and `apiVerified:true` without reporting secret values.
Docker reported
container health **unverified**, not healthy. The isolated Prowlarr project
was left running. No indexer, search, Sonarr/Radarr connection, Homarr native
integration, or rendered browser check was attempted.
