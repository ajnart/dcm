# Frigate and ArchiveTeam Warrior Compose audit

Checked 2026-10-03. Official documentation/source research and focused synthetic
validation only. No Docker apply, container restart, existing runtime inspection,
camera, media/indexer, archival job, host device, socket or privileged grant.
Context7 resolved `/blakeblackshear/frigate` and returned upstream auth/TLS and
Docker documentation; all implemented requests were checked against v0.18.0.

## Frigate

The official release page currently resolves to [v0.18.0](https://github.com/blakeblackshear/frigate/releases/tag/v0.18.0).
The existing `ghcr.io/blakeblackshear/frigate:0.18.0` catalog tag is retained.
Root's read-only bundled `app image --id frigate --json` resolved its registry
index to `sha256:9678a83a76e4730ac7d9ea7428370e32ae656d6b312aaad30d6c69f3fef14d35`
and Linux/amd64 platform to
`sha256:b1f339cf08ae9148b0fac4295cf59f8e158455f6e72d29af32b773a3d8129851`.
This is registry provenance, not image behavior or fresh-install acceptance;
no image layers were downloaded. Future plans resolve their own current pins.

The [pinned starter](https://github.com/blakeblackshear/frigate/blob/v0.18.0/docs/docs/guides/getting_started.md)
documents config/media volumes, cache tmpfs and authenticated 8971. The new
recipe preserves 1,000,000,000-byte `/tmp/cache` tmpfs and a 64 MiB shared-memory
area; these are bootstrap settings, not sizing for a selected camera. It grants
no hardware, privilege, host networking, host-root mounts, restream ports or
camera credentials. Hardware acceleration is optional: the source starter
supports CPU operation, so `capability:accelerator` is no longer mandatory.

[Pinned configuration](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/config/config.py)
explicitly defines a fresh no-camera configuration. This candidate uses
`cameras: {}` and MQTT disabled, not a dummy RTSP endpoint. Auth remains enabled;
[documented TLS-off](https://github.com/blakeblackshear/frigate/blob/v0.18.0/docs/docs/configuration/tls.md)
allows loopback-only HTTP on authenticated 8971. [Networking configuration](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/config/network.py)
supports binding unauthenticated internal 5000 to container loopback. Optional
outbound version checking and GPU/bandwidth statistics are disabled using the
[telemetry schema](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/config/telemetry.py).
The [runtime image](https://github.com/blakeblackshear/frigate/blob/v0.18.0/docker/main/Dockerfile)
keeps its image-default user; no unverified host UID is substituted.

The bootstrap config is a read-only literal generated file over the owned
config volume. Its `version: 0.18-0` matches the [migration discriminator](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/util/config.py),
avoiding first-run migration writes. Consequently camera additions through the
UI are **not supported by this bootstrap recipe**. They need a shared, reviewed
writable owner-config seed/update boundary, with private camera credentials and
exact source validation. Dashboard/admin readiness is not working NVR acceptance.

[First-admin initialization](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/app.py)
creates `admin` only when the user table is empty and emits one 32-lowercase-hex
password within the fresh-user log block. The reset path emits a different
marker and must be refused. The new shared `secrets.readBootstrapPassword()`
capability is transport-owned and fixed-allowlisted: current-start logs, exact
owned container, unambiguous fresh-user block, no caller regex and no ordinary
secret output. It is distinct from replaying creation or generic command stdout.

The [auth API](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/api/auth.py)
and [request DTOs](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/api/defs/request/app_body.py)
establish POST `/api/login` JSON `{user,password}`, **empty HTTP 200** and
`frigate_token` cookie; authenticated `/api/profile` returns `username`, `role`
and `allowed_cameras`. PUT `/api/users/admin/password` accepts `{password}` for
the exact administrator and returns `success: true`. Its cookie is a session
JWT, not a durable API key; the adapter reports `apiKey: not-created`.

The frontend boundary matters: [pinned NGINX](https://github.com/blakeblackshear/frigate/blob/v0.18.0/docker/main/rootfs/usr/local/nginx/conf/nginx.conf)
protects `/api/version` through [auth_request.conf](https://github.com/blakeblackshear/frigate/blob/v0.18.0/docker/main/rootfs/usr/local/nginx/conf/auth_request.conf),
even though [backend `/version`](https://github.com/blakeblackshear/frigate/blob/v0.18.0/frigate/api/app.py)
is marked public. The adapter therefore verifies anonymous profile denial
before login, then checks version with its authenticated cookie, before any
password rotation. `healthSource: null` makes **no anonymous health claim**.

The adapter saves a bounded bootstrap session privately, bound to the generated
owner password digest. It verifies the exact admin before reuse, preserving the
Cookie-bound deferred rotation approval. Only definitive 401 clears it;
uncertainty/403 retain it and stop. Rotation checkpoints before the one PUT.
After an uncertain response, resume proves the saved replacement password by
fresh login/profile/version, never repeats PUT. Same-owner replay proves login
again. No alternative account or invented permanent-key route is used.

The native Homarr registry mapping remains `Frigate`. At
[beffe794](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/stats/providers/frigate.ts),
its provider sends no authentication to `/api/stats`. This candidate deliberately
makes unauthenticated 5000 unreachable from shared-network peers. A working
authenticated integration needs saved username/password and a private login
response-cookie transport: `/api/login` returns an empty body, while the current
shared stats request transport assumes JSON and discards response headers.
Reusing one async auth helper for native stats and generic requests must precede
acceptance; do not work around it by publishing unauthenticated 5000.
A mapping/tile is not live native-integration or widget acceptance.

Focused evidence: `frigate-setup.test.ts` covers rotation/replay, identical
deferred PUT intent/cookie/checkpoint, lost-response recovery/no-repeat,
anonymous denial, admin role, session uncertainty and 401-only clearing. It
also compiles the recipe and asserts private 8971, internal-loopback config,
camera absence, TLS-off/auth-on, tmpfs, shared memory and no devices/privileged
fields. Adapter and fixture build pass; catalog recipe inspection passes.
Fresh-image, current-start capture against a real image, restart and cameras
remain unverified.

## ArchiveTeam Warrior

The [official variables](https://wiki.archiveteam.org/index.php/ArchiveTeam_Warrior/Docker_environment_variables)
seed HTTP username/password only; they create neither an admin account nor a
durable API key. Rechecked latest upstream `start.py` and `Dockerfile` match the
relevant [pinned startup](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/start.py)
and [image source](https://github.com/ArchiveTeam/warrior-dockerfile/blob/7682e0a0f35266fd1d31d4efe172f495c4ce10f3/Dockerfile):
existing config loads first; environment seeds only when loading fails; startup
unconditionally invokes `run-warrior3` with external Warrior HQ. The image
clones an unpinned `warrior-code2` dependency and uses mutable base references.

The [runner](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/warrior.py)
registers and updates HQ independent of selecting an archival project. Therefore
`SELECTED_PROJECT=none` is not inert and ordinary shared apply cannot authorize
those external writes. The [web handler](https://github.com/ArchiveTeam/seesaw-kit/blob/699b0d215768c2208b5b48844c9f0f75bd6a1cbc/seesaw/web.py)
HTTP auth is a separate claim from successful approved archival work.

Read-only public registry checks returned 403 for `tags/list?n=30` and 404 for
HEAD of the Dockerfile label `20260917.01`; no registry-verified fixed image or
immutable source-to-runner mapping was established. These observations do not
prove that no other tag exists. No guessed image tag, dummy recipe or setup
adapter was added.

Required common boundaries: (1) digest-backed reviewed mutable-image provenance;
(2) deploy-without-start/deferred-worker lifecycle whose exact worker start and
HQ writes require separate approval, or a verified fail-closed inert egress
bootstrap; (3) persistent seeded HTTP-credential ownership/readback without
resetting existing config; (4) honest no-API-key handoff. A one-shot job primitive
alone does not make this long-running UI/worker safe. No worker or Watchtower
socket mount was run or proposed as automatic shared app setup.
