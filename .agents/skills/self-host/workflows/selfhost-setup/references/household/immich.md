# Immich household setup recipe

Use this recipe only after `selfhost-host` has supplied current host facts and
the user has approved the exact project, storage, port, and private access
plan. Facts were checked against the official Immich documentation on
2026-09-21. Resolve a current release again at apply time.

## Plan

1. Resolve the current official release and download its release-attached
   `docker-compose.yml` and `example.env`. Record the release tag, source URLs,
   file hashes, and every resolved image digest. Keep one version across the
   server and machine-learning images; do not retain the floating `v3`,
   `release`, or `latest` tags in the approved manifest.
2. Plan the official topology: `immich-server`, `immich-machine-learning`,
   Valkey/Redis, and Immich's supported PostgreSQL image with its vector
   extension. Publish only the server's port 2283 on the approved loopback or
   private address. Keep database, cache, and machine learning internal.
3. Put uploads on the approved durable media path. Put PostgreSQL on local
   Unix-compatible storage; Immich explicitly rejects network shares for its
   database. Confirm at least 6 GB RAM for the normal topology, the CPU supports
   x86-64-v2 for v3 machine learning on amd64, and Docker Engine supports the
   release file's healthcheck syntax. Record a deliberate choice if machine
   learning is omitted on a constrained host.
4. Keep database and optional Redis credentials in opaque secret references.
   Immich supports `DB_PASSWORD_FILE` and `REDIS_PASSWORD_FILE`; the PostgreSQL
   container needs its corresponding official secret-file variable too. All
   `DB_` and `REDIS_` settings must reach every applicable Immich worker. Never
   put a secret value in the plan, Compose file, command, evidence, or Homarr
   tile.

## Compose boundary

Use the source-backed [Immich manifest builder](../immich-plan.md). The generic
owner now represents explicit dependencies and healthchecks, image-default user
evidence, secret-file environment mappings, and owned bind storage. The builder
preserves the four services, pins the recorded v3.2.2 linux/amd64 image digests,
and replaces the named model cache with an explicitly owned bind source.

The database uses the official 128 MiB shared-memory allocation. Do not drop
that setting, its healthcheck, the VectorChord image, cache, or initialization
behavior. The builder and its passing owner validation establish only a
reviewable plan; the recipe remains guided until a real apply and application
acceptance succeed.

## Apply and resume

1. Apply only through the selected owner after the exact approval token. A
   Compose start and HTTP response are apply evidence, not acceptance.
2. On resume, compare the recorded release tag, file hashes, image digests,
   paths, port, and project ownership before any mutation. If the server already
   presents login or the library, treat setup as initialized; never attempt a
   second first-user registration.
3. Ask for the first admin's full name and email at this step. Immich authenticates
   by email; the selected household username is only a display-name preference.
   For v3.2.2, prefer the versioned OpenAPI **Stable** `signUpAdmin` operation:
   `POST /api/auth/admin-sign-up` with `email`, `name`, and `password`. Send the
   generated password only in a private request body to the trusted, private
   server URL; never put it in command arguments or logs. Expect `201`, then
   verify login before recording success. The route works only while setup is
   allowed and no admin exists. If the deployed version lacks this contract or
   the call fails, use the documented **Getting Started** browser flow; do not
   retry a possibly successful signup blindly. On resume, check whether setup
   is already complete before any first-admin call.
4. After the first admin exists, set `IMMICH_ALLOW_SETUP=false` on the next
   approved Compose revision by setting the builder's required `allowSetup` input
   to `false`, then recreate the affected container. Record this as a separate
   applied change. Never resume an initialized deployment with `allowSetup: true`.

## Homarr and acceptance

1. Add one app tile using the user-reachable private URL and one integration
   using Homarr's container-reachable URL.
2. In Immich account settings (`/user-settings`), create a Homarr API key with
   only the permissions Homarr currently documents:
   `album.statistics`, `album.read`, `album.create`, `user.read`,
   `user.update`, `asset.read`, `asset.view`, `asset.download`,
   `asset.statistics`, `server.statistics`, and `server.about`. Transfer the
   key directly into Homarr's secret field and retain only its opaque reference.
3. Acceptance requires: browser login as the intended admin; the recorded
   release/version visible from the running service; upload and retrieval of a
   small authorized test image; Homarr integration test success; and a server
   stats or album widget returning authenticated data. A tile, container health,
   or HTTP 200 alone does not satisfy acceptance.
4. Resume a partial Homarr step by checking for an existing exact integration
   and widget before creating either. If an API key was already created but its
   value is unavailable, revoke it in Immich and create one replacement through
   the same private handoff; never scrape or print it.

## Official sources

- <https://docs.immich.app/install/docker-compose/>
- <https://docs.immich.app/install/environment-variables/>
- <https://docs.immich.app/install/requirements/>
- <https://docs.immich.app/administration/user-management/>
- <https://github.com/immich-app/immich/blob/v3.2.2/open-api/immich-openapi-specs.json>
- <https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/auth.controller.ts>
- Homarr source: `apps/docs/docs/integrations/immich/index.mdx` and
  `packages/definitions/src/integration.ts` in the deployed Homarr revision.
