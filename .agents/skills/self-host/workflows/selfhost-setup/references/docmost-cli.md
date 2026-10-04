# Docmost CLI adapter

Docmost is a private, collaborative docs workspace. This adapter prepares three pinned containers: Docmost, PostgreSQL, and Redis. Compose apply does **not** create the first owner automatically or claim a verified backup. Docmost login uses **email and password**; `username` in the account file is the local handoff label, not a Docmost login field.

## Input and approval

Create an owner-controlled project directory and put these JSON files inside it. Set the account file to mode `0600`. The three image values must carry verified registry digests; tags alone are rejected. The Docker context, project ownership, listener, and observed resources must come from a fresh host inspection.

```json
{
  "schemaVersion": 1,
  "project": {
    "dockerContext": "default",
    "id": "my-docmost",
    "owner": "my-docmost",
    "root": "/absolute/private/project",
    "directory": "/absolute/private/project/my-docmost",
    "ownership": "new"
  },
  "observed": {
    "checkedAt": "2026-09-25T10:00:00Z",
    "project": null,
    "ports": [],
    "paths": [],
    "networks": []
  },
  "images": {
    "docmost": "docker.io/docmost/docmost:0.96.0@sha256:<verified-digest>",
    "postgres": "docker.io/library/postgres:18.6@sha256:<verified-digest>",
    "redis": "docker.io/library/redis:8.10.2@sha256:<verified-digest>"
  },
  "hostIp": "127.0.0.1",
  "publishedPort": 3000
}
```

For a separately approved private Caddy route, the input may also include
`"integrationNetwork":{"id":"web","name":"autostack-<run>_web","owner":"external","internal":true}`.
Record that exact existing network in `observed.networks` from a fresh, complete
host inspection before planning. Only the Docmost application joins it;
PostgreSQL and Redis stay on the Docmost-private network. New media runs create
the `*_web` network for Homarr, Jellyfin, and Seerr. Do not use their default
`*_network`, which also carries Arr and qBittorrent. A Caddy route and its
client DNS/CA proof still need their own plan and approval.

The separate account file contains only non-secret account metadata:

```json
{"schemaVersion":1,"username":"admin","email":"admin@example.com","name":"Admin"}
```

Run `self-host docmost plan --project-root /absolute/private/project --input /absolute/private/project/docmost-input.json --run-id initial --account-file /absolute/private/project/docmost-account.json`. Inspect the exact plan, then pass its `approval` value to the same command with `apply` and `--approve`. Run `self-host docmost status --project-root /absolute/private/project --input /absolute/private/project/docmost-input.json --run-id initial` for a narrow health read-back.

If an initial rootless apply failed and was then scoped-stopped, run `self-host docmost recover-plan` with the same `--project-root`, `--input`, `--run-id`, and `--account-file`. The input must still be the original mode-`0600` `new` manifest. Recovery accepts either the exact failed-health checkpoint or the narrower pre-checkpoint failure where Compose `up` failed before `state.json` was written. In the latter case it deterministically reconstructs the pre-rootless numeric-user Compose plan from the unchanged input and requires that exact mode-`0600` rendered target. It validates only metadata for the retained secrets and handoff, and inspects allowlisted Docker fields for rootless mode, the three Compose-labeled containers, their original immutable Compose file and working directory, the single Compose-labeled bridge network, and the exact application port configuration. Checkpoint-backed recovery requires all services exited. Pre-checkpoint recovery also permits only Docmost itself to remain `created` when both dependencies are exited; that created container must have the exact configured `3000/tcp` binding but no active `docker port` mapping. The inspection reads only the exact `HostConfig.PortBindings` field. Database and Redis must have neither configured nor active host ports. A healthy checkpoint, running/missing/extra container, changed label, unrelated network, changed port, missing exact render, missing path, host-root-owned data directory, widened mode, symlink, or replaced start script stops recovery.

After those checks pass, `recover-plan` atomically replaces only that same input with truthful `verified-existing` ownership and exact observed project, mount paths, network, and port. It retains data, secrets, handoff, checkpoint, and the prior immutable Compose file; it does not read secret payloads, run Compose, start a container, or accept an apply token. Its output is the new read-only Compose plan and a new Docmost approval. Inspect that plan and invoke normal `docmost apply` separately with the new token. A second `recover-plan` is rejected after the input has been revised; use normal `plan` instead.

If that recovered rootless apply leaves PostgreSQL stopped because an earlier numeric-user attempt created an inaccessible `/var/lib/postgresql/18/docker`, keep the exact project stopped and run `self-host docmost repair-pgdata plan` with the same project root, input, run ID, and account file. The repair is limited to a `verified-existing` rootless project with the exact recovered observations, current immutable Compose target, absent or failed checkpoint, three exact stopped Compose containers, and exact network and port metadata. It requires the host-owned real `data/database/18` parent and a real mode-`0700` `data/database/18/docker` whose non-root owner differs from the host user. Symlinks, a healthy or different-plan checkpoint, running/missing/extra containers, a changed Compose file, host-owned PGDATA, or an existing quarantine stop the plan. Inspection uses host metadata and existing Docker labels only; it does not start a probe container or read PostgreSQL or secret content.

Inspect the returned `REPAIR-PGDATA:<project>:<digest>` approval, then pass it only to `self-host docmost repair-pgdata apply` with the same arguments. Apply repeats every check, atomically renames only `data/database/18/docker` to the deterministic owner-only quarantine sibling shown by the plan, and creates a fresh host-owned mode-`0700` `docker` directory. It never deletes or changes the quarantined data and performs no Docker mutation. The result prints the retained path, the normal unchanged `APPLY:<project>:<digest>` retry approval, and rollback instructions. Retry normal `docmost apply` separately. Keep the quarantine through first-owner and application acceptance. To roll back, stop the exact project, atomically rename the fresh PGDATA aside, then rename the reported quarantine back to `docker`; never overwrite either directory.

PostgreSQL 18's image creates `/var/lib/postgresql` as `postgres:postgres` mode `1777`, but the parent bind mount hides those image permissions. Its official entrypoint creates and re-owns only `$PGDATA`, then re-executes as `postgres`; a host-owned mode-`0700` parent therefore blocks traversal after the privilege drop. New rootless plans mount an immutable mode-`0600` wrapper that runs as container UID 0, validates the mounted password file, changes only `/var/lib/postgresql` to `postgres:postgres` mode `0700`, then starts the official entrypoint as `postgres` with the explicit `postgres` command. This keeps the first PostgreSQL process able to traverse the rootless bind mount. Existing exact v1 wrappers retain their original plan and approval digest; changing them requires a separately approved recovery, not an implicit upgrade. The explicit command is required because overriding the image entrypoint otherwise leaves an empty Compose command and the official script exits successfully without starting PostgreSQL. Rootless UID mapping keeps that parent owner-only on the host. Rootful plans retain their numeric user and do not use the wrapper.

For a stopped `verified-existing` project rendered before this wrapper existed, or one partially updated to the wrapper without the explicit command, run `self-host docmost recover-postgres-parent plan` with the same project root, input, run ID, and account file. It reconstructs and byte-verifies the exact prior Compose target, refuses a healthy or different-plan checkpoint, and requires the exact stopped three-container labels, images, port, network, host-owned mode-`0700` database parent, secrets metadata, handoff metadata, and unchanged Docmost start script. The command-recovery phase additionally permits only the exact partial Compose state where PostgreSQL has the wrapper-plan label while unchanged Docmost and Redis retain the earlier pre-wrapper label. It reads no database or secret content and starts no container. Pass the returned `RECOVER-POSTGRES-PARENT:<project>:<digest>` only to the matching `recover-postgres-parent apply`. Apply repeats every check, creates or verifies only the exact non-secret wrapper, and atomically revises the owner-controlled input only when its owned wrapper path was missing. It does not modify Docker or database data. Then run normal `docmost apply` separately with the returned new approval and immutable Compose target. All earlier Compose files and any PGDATA quarantine remain retained.

`apply` creates only this project, its three data directories, owner-only secret files, an immutable Compose file, and a mode-`0600` private handoff. It starts the exact Compose project and probes `/api/health`; a health failure returns exit code 3. A healthy response still means first-owner setup is pending.

For the experimental v0.96.0-pinned API path, run `self-host docmost owner plan` with the same project root, input, run ID, and account file. It is read-only and freezes the healthy Compose checkpoint, selected loopback origin, account identity, and generated owner credential behind an exact `OWNER:<project>:<digest>` approval. Pass that token only to `docmost owner apply` with the same arguments. Apply is limited to the adapter's selected `127.0.0.1` or `::1` HTTP origin; a plain private-LAN listener must use a protected browser or a separately approved HTTPS owner path. Apply sends `{name,email,password}` to `POST /api/auth/setup` with a five-second timeout, no redirects, and a bounded response. Setup success requires HTTP 200, the expected workspace envelope, and an `authToken` cookie. HTTP 403 is treated as a possible prior setup only when a fresh `POST /api/auth/login` with the exact account succeeds and returns its own cookie. Cookies, passwords, and raw response bodies are never written to output or the owner-only checkpoint. Use `docmost owner status` for its narrow read-back.

This Community route is taken from pinned v0.96.0 source and is not a supported public API contract. Any timeout, redirect, unexpected status, response mismatch, or failed login leaves browser fallback required. The API checkpoint proves only first-owner creation plus a fresh adapter login; fresh-client login, page edit, attachment and Homarr tile remain separate acceptance. Recovery stays unverified unless separately selected backup protection passes an isolated restore. Keep first-owner setup off public ingress. A private LAN HTTP bind is not encrypted; prefer loopback, an SSH tunnel, or separately approved HTTPS.

## Deterministic app check

After the API owner checkpoint has recorded its workspace and default-space
identity, use the separately approved `docmost accept plan|apply|status` path:

```bash
self-host docmost accept plan --project-root /absolute/private/project \
  --input /absolute/private/project/docmost-input.json --run-id initial \
  --account-file /absolute/private/project/docmost-account.json
# Review the synthetic artifact names and exact token before applying:
self-host docmost accept apply --project-root /absolute/private/project \
  --input /absolute/private/project/docmost-input.json --run-id initial \
  --account-file /absolute/private/project/docmost-account.json \
  --approve ACCEPT-DOCMOST:PROJECT:REVIEWED_DIGEST
self-host docmost accept status --project-root /absolute/private/project \
  --input /absolute/private/project/docmost-input.json --run-id initial
```

The plan is read-only. Apply logs in, checks the exact owner and workspace,
creates and edits one synthetic page, uploads one small synthetic attachment,
then uses a second fresh login to read the edited content, attachment linkage
and exact downloaded bytes. It retains only those new artifacts for inspection;
existing pages and files remain unchanged. Cookies stay in memory, and download
requests stay on the approved loopback origin.

A durable attempt consumes the one write pass. After an interrupted or unknown
result, inspect `accept status`, then run `accept verify` with the same root,
input, run ID and account file. This logs in and reads only that attempt's
synthetic page and uniquely matched attachment, then checks the content and
downloaded byte hash. It may save owner-only readback evidence; it never repeats
the upload or alters the original attempt ledger. Missing or ambiguous artifacts
remain unverified. API acceptance proves storage and retrieval,
not attachment rendering in the editor, a browser login, Homarr or a restore.
This is an experimental adapter for exact
[v0.96.0 source](https://github.com/docmost/docmost/tree/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af),
not the supported Enterprise API or a contract for another release.

Household bundles expose the same boundary through
`bundle stage --service docmost --phase accept-plan|accept-apply|accept-status|accept-verify`.
The apply phase requires both the unchanged bundle approval and this separate
adapter token. For a newly API-created managed workspace, `bundle approvals`
offers its full acceptance plan and exact token; `bundle run` advances this
check only after that separate approval. Accepted or verified-readback status
skips only the API gate. A consumed unknown attempt returns manual verification
guidance rather than another upload command. Its plan/status can also run while
another app awaits a decision.
An existing-owner checkpoint without workspace-backed API proof uses protected
browser checks instead; the bundle can continue independent apps without
granting synthetic-write approval. A known consumed attempt still forbids replay.

## Native database export

For the exact applied Docmost adapter, `docmost db-export plan|apply|status`
exports only its PostgreSQL database. The destination must already be a real,
caller-owned mode-`0700` directory outside the project; the `.dump` output and
its attempt records must not exist. Plan reads bounded container metadata and
binds the pinned image, current container, manifest, checkpoint, rendered
Compose, and destination to a separate `EXPORT-DOCMOST` approval.

```bash
self-host docmost db-export plan --project-root /absolute/project \
  --input /absolute/project/docmost-input.json --run-id initial \
  --account-file /absolute/project/docmost-account.json \
  --destination /absolute/private-backups \
  --output /absolute/private-backups/docmost.dump
```

Repeat those flags with `apply --approve EXPORT-DOCMOST:PROJECT:REVIEWED_DIGEST`
only after reviewing the plan. Apply streams native `pg_dump` custom format
directly to exclusive mode-`0600` staging; no password is placed in arguments
or output. The pass is capped at 512 MiB. An in-container deadline sends TERM
after 120 seconds, then KILL after five more; the CLI has a 130-second watchdog.
Missing deadline support fails closed. Use `status` with
the same flags to verify the retained export's bytes and hash. A failed,
interrupted, or damaged attempt remains `unknown-no-replay`; keep its files
for diagnosis rather than replaying or replacing them.

The archive contains private database contents. This is an unencrypted local
single-database export—not a complete app backup, writer quiescence, off-host
protection, or restore. Attachments, Redis AOF, secrets, and cluster-global
roles are not captured. A later full capture and isolated restore require
their own approved consistency, storage, and application checks. See the
[PostgreSQL 18 export contract](https://www.postgresql.org/docs/18/app-pgdump.html).

## Browser fallback

For API failure on a loopback Docmost run, start an isolated `agent-browser` session named `selfhost-docmost-<run-id>`, open its reported URL, and inspect only fresh form refs. Fill one or two enabled password fields without printing their values:

```bash
self-host docmost browser-password --project-root /absolute/private/project \
  --run-id initial --ref @eN [--browser-bin ABSOLUTE]
```

Repeat `--ref` only if the visible setup form has a confirmation field. This command requires the exact healthy CLI checkpoint and owner-only handoff, validates the browser is on this run's loopback `/setup/register` or `/login` page, checks each ref is a password input, then sends the generated password through `agent-browser batch` stdin. It prints only `PASS` or a generic failure. Fill non-secret account fields separately, submit once, and verify the rendered outcome. Do not use `get value`, raw input snapshots, a password-bearing command argument, or this helper for a LAN/public origin.
If multiple browser installations exist, pass the same absolute executable used
to open `selfhost-docmost-<run-id>` with `--browser-bin`. Symlinks resolve once
to a regular executable that is not group/world writable; every helper call
uses that canonical binary, with no fallback after failure. Omit the option
only when the PATH-selected browser owns the intended session.

Docmost has no documented `APP_SECRET_FILE` or `DATABASE_URL_FILE`. A mounted, non-secret startup script reads mode-`0600` files, then places Docmost's required values only in its process environment. Compose configuration, command arguments, and CLI output contain paths, not values. On rootful contexts PostgreSQL reads its password through the official `POSTGRES_PASSWORD_FILE` entrypoint. The new rootless wrapper reads the same mounted file before dropping privileges and passes the validated password to that official entrypoint through its process environment.

On a rootful context, all three services keep the caller's numeric non-root host UID/GID. On the exact `rootless` context, all three explicitly use container `0:0` with the Docker rootless UID-mapping evidence surfaced in the plan. Lifecycle preflight verifies that context reports rootless mode. Container root then maps to the invoking host user, so Docmost can read the owner-only secrets and attachments while Redis can initialize its mode-`0700` bind directory. The PostgreSQL wrapper transfers only its mode-`0700` parent bind to the mapped `postgres` identity before the official entrypoint initializes and re-owns PGDATA and drops privileges. The project directory, attachment directory, secrets, handoff, and wrapper remain owned by the invoking host user; no host path or secret mode is widened.

Changing between the rootful and rootless runtime contracts changes both the Compose plan ID and the Docmost approval digest, so an old approval token is invalid. A failed rootless apply may be retried with the same run and handoff only after fresh inspection records the retained project, paths, port, and network as `verified-existing`; the new immutable Compose target is added without deleting the old one. A prior failed-health checkpoint may be replaced by the new approved plan, but a healthy checkpoint cannot be silently rebound. Rootless PostgreSQL and Redis retries accept only their exact non-root-owned mode-`0700` data directories after the official entrypoints re-own them.

Docmost Community has no dedicated Homarr integration in the reviewed catalog; attach it as an app tile only. The reviewed upstream docs do not provide a full backup/restore recipe for PostgreSQL, local attachments, and Redis AOF together, so recovery stays unverified until an isolated restore succeeds.

Sources: [Docker rootless mode](https://docs.docker.com/engine/security/rootless/), [Docmost v0.96.0 Compose](https://raw.githubusercontent.com/docmost/docmost/v0.96.0/docker-compose.yml), [tagged Dockerfile](https://raw.githubusercontent.com/docmost/docmost/v0.96.0/Dockerfile), [installation and first-owner setup](https://docmost.com/docs/installation), [environment variables](https://docmost.com/docs/self-hosting/environment-variables), [PostgreSQL 18 official entrypoint](https://github.com/docker-library/postgres/blob/master/18/trixie/docker-entrypoint.sh), [PostgreSQL 18 official Dockerfile](https://github.com/docker-library/postgres/blob/master/18/trixie/Dockerfile), [PostgreSQL arbitrary-user notes](https://hub.docker.com/_/postgres), [Redis official entrypoint](https://github.com/redis/docker-library-redis/blob/master/docker-entrypoint.sh).
