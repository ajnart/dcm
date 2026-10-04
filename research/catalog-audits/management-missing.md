# Management apps — checked 2026-10-03

Reused the existing `product/research/catalog-{coolify,dockge,portainer,patchmon}-2026-09-30.md`
investigations and pinned PatchMon first-admin adapter before extending anything.
Context7 resolved `/patchmon/patchmon`; its deployment and password-policy docs
were checked against v2.1.3 source. No Docker apply or live acceptance occurred.

## PatchMon: shared candidate and headless dashboard owner

Added the four-service [v2.1.3 topology](https://github.com/PatchMon/PatchMon/blob/v2.1.3/docker/docker-compose.yml):
private dashboard, PostgreSQL 17, authenticated Redis 7.4 and unpublished guacd
1.6.0. guacd retains read-only root, all capabilities dropped, no-new-privileges,
64 MiB `/tmp`, 512 MiB memory and one CPU. The loopback origin drives CORS.
The server's documented [`POD_ID` fallback](https://github.com/PatchMon/PatchMon/blob/v2.1.3/server-source-code/cmd/server/main.go)
provides stable presence identity without introducing a host-name primitive.

Redis receives `requirepass` through a generated mode-0600 private configuration,
not argv or a plaintext catalog value. Its [official entrypoint](https://github.com/redis/docker-library-redis/blob/master/7.4/alpine/docker-entrypoint.sh)
supports a selected numeric user; the shared renderer already rejects UID/GID
zero. Using that project owner's UID for Redis and its owned `/data` bind permits
reading the private config without widening its permissions. The server waits
for PostgreSQL/guacd health and Redis start; its [startup authenticates and pings Redis](https://github.com/PatchMon/PatchMon/blob/v2.1.3/server-source-code/cmd/server/main.go)
before serving HTTP and exits on failure. Setup independently verifies `/health`
reports `ok` for both [database and Redis](https://github.com/PatchMon/PatchMon/blob/v2.1.3/server-source-code/internal/server/router.go).
This avoids upstream's secret-bearing Redis healthcheck argv.

The existing [first-admin handler](https://github.com/PatchMon/PatchMon/blob/v2.1.3/server-source-code/internal/handler/auth.go)
creates only `admin`, an active superadmin with the owner-selected email. The
adapter inspects first-run state, checkpoints before creation, verifies the
saved password against login/profile, compares administrator identity on resume
and refuses replay after an ambiguous write. Generated passwords retain the
[default complexity policy](https://github.com/PatchMon/PatchMon/blob/v2.1.3/docker/env.example)
and fit bcrypt's 72-byte limit; the adapter rejects a malformed generated value
before sending it. It does not disable the upstream policy.

Still separate: image/digest resolution, real private dashboard/CORS proof,
fresh-image login, restart persistence and isolated restore. Agent enrollment,
remote desktop and patch execution need exact host-specific approval and their
own acceptance. No inventory or patch success is inferred from dashboard login.
Support remains discovery; a recipe and synthetic fixture do not promote it.

Optional Homarr credentials require explicit
`credential-authority=stats-and-enrollment`. The pinned
[Homarr client](https://github.com/homarr-labs/homarr/blob/beffe794022c22c43dd458999ee2a016bb1df2e6/packages/integrations/src/patchmon/patchmon-integration.ts)
calls `/api/v1/gethomepage/stats` using Basic auth with two separate secrets.
PatchMon [token creation](https://github.com/PatchMon/PatchMon/blob/v2.1.3/server-source-code/internal/handler/auto_enrollment.go)
must therefore use `integration_type: gethomepage`, not `api`.
Creation returns `token_key` and once-visible `token_secret`. The existing atomic
mode-0600 API-key writer stores one bounded JSON pair `{apiKey,apiSecret}`;
neither component is included in setup records/checkpoints. Inventory before
creation and [owner/type/active/expiry/policy readback](https://github.com/PatchMon/PatchMon/blob/v2.1.3/server-source-code/internal/store/auto_enrollment.go)
verify the exact token, followed by independent Basic-auth statistics parsing.
An interrupted creation without saved secret never replays; an interruption
after the atomic save reconciles the existing token without another POST.
The short-lived dashboard session is kept separately in the exact-owner/origin
mode-0600 session-cookie facility only after owner profile readback. Resume
reuses it; only HTTP 401 invalidates it, while uncertain failures preserve it.
Owner readback does not rewrite an unchanged checkpoint, keeping deferred
token/statistics approvals stable. Each real checkpoint write preserves the
existing non-secret fields explicitly because the shared transport replaces,
rather than merges, checkpoint data.

Important authority expansion: the pinned enrollment handler does **not** check
`integration_type` or scopes. A GetHomepage statistics credential can also enroll
hosts. Scope filters only apply to the separate generic API; creation stores
`scopes: null` for GetHomepage. This cannot honestly be called a read-only token.
The adapter requires the explicit choice and an exact write approval disclosing
that authority, limits it to one host per day and makes no enrollment request.
Default dashboard setup returns `credential-authority-required`, no generated
integration key and not-ready for full integration setup. The original media
approval is not treated as this new token's authority approval.

## Host-control apps: exact authority gap

| App | Upstream evidence | Required before a reusable working recipe |
| --- | --- | --- |
| Coolify | [Production Compose](https://github.com/coollabsio/coolify/blob/main/docker-compose.prod.yml) has owned host paths and external `coolify` network; [server control](https://coolify.io/docs/core/security/credentials/ssh-keys) uses SSH. It does not require a production socket mount. | Explicit selected-host SSH/Docker authority, immutable installation ownership, external-network adoption, private root credential bootstrap and checkpointed [team/scoped API token](https://coolify.io/docs/core/security/credentials/api-tokens) capture. Public proxy/DNS/TLS is separately approved. |
| Dockge | [Pinned 1.5.0 Compose](https://github.com/louislam/dockge/blob/1.5.0/compose.yaml) requires Docker socket and identical absolute writable stack paths. [Pinned handler](https://github.com/louislam/dockge/blob/1.5.0/backend/socket-handlers/main-socket-handler.ts) has internal Socket.IO account events. | Independently reviewed daemon authority and stack-tree ownership, exact image/digest, source-locked Socket.IO checkpoint/replay/account proof. No supported durable API-key route is claimed. |
| Portainer | [Official installation](https://docs.portainer.io/start/install-ce/server/docker/linux) grants daemon access. [First-admin password file](https://docs.portainer.io/advanced/cli) avoids the [2.39.4/2.43+ setup-token gate](https://docs.portainer.io/faqs/installing/setup-token). | Approved daemon/socket/Agent or mutually authenticated TLS endpoint boundary; private certificate/key lifecycle and connected-environment readback. Then pinned administrator bootstrap, login and [once-issued access token](https://docs.portainer.io/api/access) capture/replay handling. A UI without an owned environment is not a container manager. |

These remain discovery-only, without misleading UI-only recipes or `no-account`
adapters. A socket mounted read-only still allows powerful daemon API operations;
[Docker documents host-root implications](https://docs.docker.com/engine/security/protect-access/).
Private UI publication does not narrow SSH/socket/daemon privilege. The existing
seven-service media approval does not authorize any of these deployments.

## Focused validation

- PatchMon `validateAppRecipe(recipe, manifest)`: no errors.
- Changed `setup.ts`: Bun build passed.
- App-local `check-setup.ts`: synthetic fresh owner, saved-owner replay,
  lost-response login reconciliation, lost-response no-admin stop, unowned
  administrator refusal, email/account-ID drift and unhealthy Redis rejection passed.
  Optional token opt-in, private-pair capture, inventory/authority drift,
  lost token response refusal, interruption after atomic save reconciliation,
  Basic-auth stats readback and secret-free setup records also passed.
- `check-deferred-setup.ts` exercised the actual shared transport against a
  synthetic loopback upstream: identical deferred token and statistics approval
  hashes across invocations, session reuse without repeated login, mode-0600
  session/pair storage, preserved session on 403/503, replacement only after
  definitive 401 and exactly one API credential creation passed. This caught
  checkpoint revision churn and replacement-versus-merge errors that the earlier
  in-memory fixture could not establish; both fixtures now pass.
- Whole-catalog validation belongs to the coordinating agent; an unrelated
  concurrently edited Tracearr recipe temporarily blocked the catalog CLI.

A fresh read-only shared plan subsequently passed for project `patchmon-review`
at mode-0700 `/tmp/selfhost-patchmon-review-20261003.D6hmqp`, publishing only
`127.0.0.1:13003` for the dashboard. Its four registry-resolved image digests and
reviewed recipe produced plan ID `b5e819ad3e566f80` and exact deployment approval
`SHARED-APPLY:patchmon-review:6cc80ede476e876f1524a1378fcaae68cb595103d662711ae016433105940028`.
This approval was prepared, not exercised. It is scoped to that new isolated
owner, not the existing media deployment or optional token-creation authority.
Re-plan before applying if any image, port, recipe or owner details change.

No Docker apply, browser, host enrollment, SSH grant, API credential creation,
restart or restore was run. These checks are implementation-boundary evidence,
not live upstream compatibility or completed app acceptance.
