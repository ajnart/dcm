# Nextcloud acceptance route review

Reviewed 2026-09-29 on `feat/headless-fallback-handoff` (`2a9f3b8`). Read-only source review; no tests, Docker, live service, browser, or host acceptance was run. Context7 lookup hit its monthly quota, so documentation below was checked directly against first-party Nextcloud docs and source.

## Current boundary

The existing [v2 recipe](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/nextcloud/recipe.json) already models `nextcloud`, MariaDB, Redis, and the `/cron.sh` sidecar. It uses the image's file-backed first-admin password and declares OCS login, WebDAV CRUD, cron, and restart-persistence acceptance. The initial adapter checked `/status.php` and Basic-auth `/ocs/v1.php/cloud/capabilities`, but capabilities is public and was not authentication proof. The current [adapter](../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/nextcloud/setup.ts) also requires the documented admin-only `/ocs/v1.php/cloud/users` read before its WebDAV probe.

Generic schema-v2 `app plan/apply/status/handoff/up/down` support exists in `packages/cli/src/app.ts`, but the catalog router's explicit apply allowlist excludes Nextcloud (`selfhost.ts:462-474`). The recipe's `initial-admin-from-file` onboarding already satisfies the router's accepted v2 onboarding shape, so the allowlist is the first install blocker. There is no Nextcloud-specific CLI login check or WebDAV/persistence acceptance path: `app onboard` is for API-created first admins, while `app persistence-start|finish` currently covers Immich and Paperless. The generic setup engine can run and re-inspect the Nextcloud adapter, but its result explicitly leaves function and restart checks separate.

## Safe next implementation

1. Enable only the bundled Nextcloud v2 recipe for bounded apply; preserve the exact project, digest, private-file, and approval checks. Keep its maturity experimental. The Docker image performs first-run account creation from the complete database and admin inputs, so do not add browser automation or replay account creation against an existing volume.
2. Use the protected OCS user-list read as the direct API admin proof (or expose that same check through `app login-check --id nextcloud`). Capabilities alone cannot prove login. A successful protected read still does not prove a browser session or UI login.
3. Add an exact-project WebDAV canary and restart-persistence route. Gate the upload/delete and lifecycle changes with fresh exact approvals; persist the canary path and content hash before the write; use authenticated PUT/GET/DELETE under `/remote.php/dav/files/admin/`; then use the existing separately approved `app down`/`app up` and re-read the same bytes before recording persistence. Keep any failed/ambiguous write inspectable and do not blindly replay it. Record cleanup separately if the probe cannot be removed.
4. Keep `background-jobs` as its own check: prove cron mode and a successful scheduled invocation rather than treating a running sidecar as proof. Do not promote support or claim acceptance until the new route passes on a fresh isolated project.

Focused static checks after implementation: compile the changed CLI and adapter with `bun build <changed.ts> --target=bun --outfile=/dev/null`; run `bun .agents/skills/self-host/workflows/selfhost/scripts/check-multi-service-recipe.ts`; extend and run `bun .agents/skills/self-host/workflows/selfhost/scripts/check-nextcloud-setup.ts` for OCS auth, WebDAV failure/retry, checkpointing, and cleanup cases; and run only the affected generic CLI fixture (likely `bun packages/cli/tests/app-multi-manifest.test.ts`). These prove source contracts only. No checks were run in this review.

Live acceptance still needs a fresh isolated Compose project, resolved platform digests and secret-file readability, successful OCS authentication, exact WebDAV content roundtrip, observed cron execution, approved scoped restart with account/file read-back, and (if recovery is claimed) an isolated restore. None is established by the recipe, API fixture, HTTP 200, or Compose liveness. No Docker mutation was authorized here.

## First-party documentation checked

- The [official Docker image README](https://github.com/nextcloud/docker/blob/master/README.md) documents `_FILE` inputs and says a complete database configuration plus both initial-admin fields fully automates initial installation and bypasses the web wizard. It also documents the Apache port and app/cron shared `/var/www/html` volume pattern. The linked [Compose example](https://github.com/nextcloud/docker/blob/master/.examples/docker-compose/insecure/mariadb/apache/compose.yaml) is under `insecure/`; use its service/volume topology as evidence, not its security posture or floating image tags.
- Nextcloud's [OCS API overview](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/OCS/ocs-api-overview.html) documents authentication, the admin-only user-list endpoint, `OCS-APIRequest: true`, and JSON with `Accept: application/json`. The [capabilities controller](https://github.com/nextcloud/server/blob/master/core/Controller/OCSController.php) marks that route public. The [status endpoint source](https://github.com/nextcloud/server/blob/master/status.php) emits `installed`, `maintenance`, `needsDbUpgrade`, and `versionstring`.
- The Nextcloud 35 [WebDAV guide](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html) documents authenticated `/remote.php/dav/files/{user}/...` operations, including PUT, GET, and DELETE. This is sufficient for an API-only login/function check without browser access.

## Implementation follow-up

The per-app adapter now checkpoints one approved WebDAV PUT, reads the exact saved bytes, and rechecks that same file on resume. The focused fixture covers normal setup, changed content, missing output after an uncertain write, and a lost response after a successful write. It does not clean up the probe, prove cron execution or a restart, enable the CLI apply route, or establish live acceptance.

The bundled Nextcloud recipe is now connected to the generic experimental `app plan`/`app apply` route. This only authorizes a digest-pinned, separately approved Compose start; it does not promote application acceptance. A read-only plan for isolated `/tmp/selfhost-nextcloud-X5gdSn` on loopback port 38080 stopped before approval because Docker Hub returned HTTP 429 resolving `nextcloud:35.0.1-apache`. No image was pulled, project state written, or container started. Retry registry resolution after authenticated access or rate-limit recovery, then run the complete isolated acceptance route above.

The 2026-09-29 source follow-up found a version ambiguity: the Docker Official
Images `library/nextcloud` manifest lists `35.0.1-apache`, but the current
[`35/apache/Dockerfile`](https://github.com/nextcloud/docker/blob/master/35/apache/Dockerfile)
still sets `NEXTCLOUD_VERSION=35.0.0`. This does not establish the bytes behind
the published tag. The catalog image status is `verify` until the registry
digest and a fresh `/status.php` version read agree. The catalog also no longer
requests PostgreSQL and Valkey as dependencies: the bundled Compose recipe
actually provisions MariaDB and Redis. These are recipe-internal services, not
extra app tiles. An existing install needs a separate approved trusted-domain
change; editing `NEXTCLOUD_TRUSTED_DOMAINS` only affects first installation.
See the [official image README](https://github.com/nextcloud/docker/blob/master/README.md)
and [entrypoint](https://github.com/nextcloud/docker/blob/master/docker-entrypoint.sh).

The manifest's [specific docker source commit](https://raw.githubusercontent.com/nextcloud/docker/6edd06e23466ed44d48e3d467b09e0c5fc0ffc17/35/apache/Dockerfile)
sets NEXTCLOUD_VERSION to 35.0.1. That resolves the source-tree
discrepancy, but does not prove the published image digest or a running
container's bytes. The per-app adapter's status.php provenance now points
to the pinned server v35.0.1 source rather than the moving master branch.
