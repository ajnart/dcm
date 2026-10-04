# Rootless shared-media preflight seam

Source-only review, 2026-10-03. No Docker operations or private files inspected.

## Existing implementation

- `packages/cli/src/lib/shared-host-observation.ts`: `sharedHostFacts(report, request, volumeNames)` is the existing read-only seam. It already refused shared media when the context name was `rootless`, but ignored observed daemon mode. `requireLocalSharedDockerContext(context)` separately verifies an exact local socket endpoint; it does not prove rootless namespace mode.
- `.agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh` queries `docker info --format '{{json .SecurityOptions}}'` and emits `runtime.docker.rootless: {state, value}`. Its current context observation scopes that probe. Subordinate UID/GID observations only report whether entries exist; they do not capture the active daemon namespace maps.
- `packages/cli/src/lib/shared-compose-project.ts`: `prepareSharedProjectFiles()` creates shared media directories via `privateDirectory()` in `multi-service-recipe.ts`, enforcing current-host-user ownership and mode 0700. `multiServiceManifest()` binds recipe `hostEnvironment` UID/GID variables to that same inspected host identity, with no rootless translation.
- `.agents/skills/self-host/workflows/selfhost-compose/scripts/compose-project.ts`: `verifyLifecycleTarget()` calls `verifyMountSources()`. That function checks existence, type and symlinks, not application-identity read/write access. `buildAssessment()` uses declarative ownership claims, not filesystem permission evidence.
- `compose-lifecycle.sh` confirms actual rootless SecurityOptions only for the literal `rootless` context. Other contexts check ServerVersion. Compose config validation does not prove application access to binds.

## Minimal implemented fix

Reuse `sharedHostFacts()` and the existing host report; no new interface, namespace engine, PUID translation or diagnostic framework. Require rootless mode to be observed and Boolean. Refuse `rootless` context with a non-rootless daemon. Apply the existing media-bind refusal to actual daemon rootless mode, including a rootless daemon behind `default`. This closes the context-name bypass before preparation/apply, including saved prepared media paths.

It remains a conservative support gate, not a claim that all rootless binds are inaccessible. Non-media rootless planning remains possible. Existing independent manifest, endpoint and lifecycle checks remain unchanged.

`packages/cli/tests/shared-host-observation.test.ts` covers missing/unknown/non-Boolean mode, contradictory context, default-context rootless media, prepared rootless media, and non-media rootless planning. Other existing report fixtures were updated mechanically to include their rootful daemon observation.

Validation: `/home/habs/.bun/bin/bun packages/cli/tests/shared-host-observation.test.ts` passed; focused Bun build of `shared-host-observation.ts` passed. No other fixture or suite ran.

## Required host choice / deferred capability

Container UID 0 mapping to the host operator does not make LinuxServer application users UID 0: image init and application identities differ. LinuxServer's official policy does not formally support PUID/PGID 0 ([policy](https://docs.linuxserver.io/misc/support-policy/#weird-exceptions)); the sibling runtime audit records pinned-image evidence separately.

The operator must choose a separately reviewed supported daemon/runtime arrangement or a narrowly approved data-permission strategy after actual namespace and application identities are known. This fix does not chmod, chown, widen directories, switch contexts, use sudo, alter sockets, or set PUID/PGID 0. No host mutation is authorized by a failed gate.

A future precise generic bind-access capability belongs inside Compose preflight after actual daemon security-mode inspection: one `verifyBindAccess(manifest, daemonIdentityEvidence)` module returning per-service/source blocked evidence. Reuse normalized service users, mounts and bounded metadata inspection; image-default application identities require reviewed evidence rather than assuming PID 1. Actual UID/GID maps must be observed, not derived from context names or mere `/etc/subuid` presence. Do not add this larger capability until the host decision and necessary identity evidence are available.
