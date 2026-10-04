# Existing data, monitoring, and infrastructure apps

Audit date: 2026-10-03. Source review, synthetic fixtures, fresh installation,
same-owner replay, restart persistence, and Homarr publication are separate
evidence. None of the readiness-only probes below proves useful application
acceptance. No credential stores were read for this audit.

## Corrections and live observations

- Grafana 13.2.2 runs as UID 472. Its entrypoint reads `GF_*__FILE` as that
  user, but local Compose secret files are host-owner mode 0600. Changed its
  recipe to the documented `GF_SECURITY_ADMIN_PASSWORD` private env-file
  binding and corresponding secret-env onboarding, retaining the image user.
  Docker operators can inspect that environment. Verified against the pinned
  [Dockerfile](https://github.com/grafana/grafana/blob/v13.2.2/Dockerfile) and
  [entrypoint](https://github.com/grafana/grafana/blob/v13.2.2/packaging/docker/run.sh).
- `packages/cli/tests/grafana-setup.test.ts` passes with Bun 1.4.0: recipe
  binding, unchanged image user, saved Basic credential, exact active server
  administrator, replay, wrong identity/role/disabled account/401, owner mismatch,
  and secret-free result. Its focused Bun build also passes. This is synthetic,
  not a fresh Grafana installation.
- Existing focused Immich closure and acceptance fixtures
  (`packages/cli/tests/immich-close-setup.test.ts` and `immich-accept.test.ts`)
  also passed; their fake Docker/HTTP boundaries do not reverify the live trial.
- Existing approved trial `/tmp/selfhost-homarr-stack-20260930.vbcN32`:
  Immich's four containers were running with healthy image/recipe probes.
  This audit did not reverify account, key, photo round-trip, or restart.
- Paperless in that trial was running but **unhealthy**: the image's inherited
  `curl -fs -S -L --max-time 2 http://localhost:8000` received HTTP 500 at the
  redirected login page. Bounded exception lines identified unresolved `db`.
  Correct aliases and common private-network ownership were present; a fixed
  TCP connection to the database IP on 5432 succeeded. A direct query to the
  configured Docker resolver `127.0.0.11:53` returned NXDOMAIN and zero answers.
  Thus a Compose alias error and a dead database were not supported; embedded
  Docker DNS resolution failed. Shallow `/` and `/api/` probes returned 302,
  not proof of usable authenticated application access.
- The approved exact Compose service-only Paperless restart completed, but the
  DNS query still returned NXDOMAIN. Startup subsequently waited for PostgreSQL
  and Redis, with the HTTP healthcheck unavailable. No daemon restart, network
  replacement, account reset, or changes to other projects were attempted.
- Catalog validation attempted during concurrent work was blocked by Tracearr's
  source/image mismatch, outside this app ownership. Do not call it a passed
  catalog gate until the reconciled tree is checked.

## Per-app evidence and remaining boundary

"Source" below describes reviewed catalog declarations and primary evidence;
it is not registry availability or fresh image execution. "Not run" applies
to fresh/replay/restart/Homarr checks in this audit unless explicitly stated.

| App / pinned image | Source and bootstrap boundary | Fixture / fresh / replay / restart / Homarr |
| --- | --- | --- |
| Immich v3.2.2 | [Pinned official Compose](https://github.com/immich-app/immich/blob/v3.2.2/docker/docker-compose.yml): four services, image-default users, database password file. Adapter checkpoints signup and one-time scoped Homarr key creation, verifies saved admin and exact key metadata; shared result explicitly keeps setup open. | Existing closure/acceptance fixtures passed. Existing trial image health observed only. Account/key/photo/replay/restart/publication not reverified here. |
| Paperless-ngx 3.2.1 | [Pinned Dockerfile](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/Dockerfile), official PostgreSQL Compose, USERMAP_UID/GID and supported password/secret files; PostgreSQL 18 parent-directory mount. Adapter proves saved superuser and token identity/statistics. | Existing trial direct acceptance failed due Docker DNS; approved container-only restart did not recover. No token/account reset or successful replay claimed. |
| PhotoPrism 260728 | [Configuration](https://docs.photoprism.app/getting-started/config-options/): image-default user, SQLite, writable originals/storage, admin private environment. Session login is not indexing/photo acceptance. Response identity proof is weaker than Grafana and needs pinned response/source and fresh validation before promotion. | Not run. |
| Stirling PDF 3.0.0 | [Configuration](https://docs.stirlingpdf.com/Configuration/): explicitly disables login, configs volume, no fabricated credentials. Adapter identifies local HTML only; PDF processing remains pending. | Not run. |
| Open WebUI v0.11.4 | [Pinned auth router](https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/routers/auths.py): saved email/password admin signin, transient bearer discarded. Private env admin/application keys; persistent data volume. Provider/model/chat not proven. | Not run. |
| Ollama 0.34.1 | [Pinned Dockerfile](https://github.com/ollama/ollama/blob/v0.34.1/Dockerfile): private unauthenticated API, persistent model volume, no UID/PUID fiction. Adapter checks exact version and model inventory, not inference. | Not run; no model download authorized. |
| PostgreSQL 18.6 | [Official image](https://hub.docker.com/_/postgres): password file, image entrypoint ownership, `/var/lib/postgresql` parent mount. Adapter uses stdin for password and TCP query, rejecting a wrong password before accepting saved credential. | Registry digest resolved for proposed batch. Fresh/replay/restart pending approval; no Homarr database integration claim. |
| Valkey 9.1.2 | [Security](https://valkey.io/topics/security/): no account/ACL claim; protected mode disabled explicitly, loopback publication and owned project isolation matter. Container-local PING proves readiness only, not peer access, cache persistence, or authentication. | Registry digest resolved; remaining checks pending approval. |
| Loki 3.7.0 | [Pinned local configuration](https://github.com/grafana/loki/blob/v3.7.0/cmd/loki/loki-local-config.yaml): image-default user and persistent `/loki` volume; no native auth invented. `/ready` is only readiness; ingestion/query/retention remain pending. | Registry digest resolved; remaining checks pending approval. |
| Vector 0.58.0-debian | [Pinned server](https://github.com/vectordotdev/vector/blob/v0.58.0/src/api/grpc_server.rs) preserves HTTP `/health` with `ok:true` on the gRPC port. Literal generated config uses internal logs to console only; no Docker socket or real telemetry claim. | Registry digest resolved; remaining checks pending approval. |
| Unbound 1.26.0-0 | [Image maintainer documentation](https://github.com/madnuttah/unbound-docker/blob/main/doc/README.md), not a fabricated upstream-owned image: image-default user, documented TZ. Fixed local UDP/TCP queries prove recursive response, not host/peer DNS configuration. | Not run. No host DNS change approved. |
| VictoriaMetrics v1.153.0 | [Single-node docs](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/): persistent data path, self-scrape, no account. Health/build-version reads do not prove selected application metric ingestion or retention. | Registry digest resolved; remaining checks pending approval. |
| Prometheus v3.15.0 | [Pinned Dockerfile](https://github.com/prometheus/prometheus/blob/v3.15.0/Dockerfile): image-default non-root runtime and persistent `/prometheus` volume. Readiness/build version only; chosen targets, scrape success, and durable queries pending. | Registry digest resolved; remaining checks pending approval. |
| Grafana 13.2.2 | Pinned Dockerfile/entrypoint above; corrected non-root-readable private-env bootstrap. Saved Basic credentials must resolve to active `admin` with server-admin role; no datasource fabricated. | Focused synthetic fixture/replay and build passed. Registry digest resolved. Fresh/restart/Homarr pending approval. |
| Kopia 0.23.1 | [Pinned server](https://github.com/kopia/kopia/blob/v0.23.1/internal/server/server.go) authenticates current-user before repository connection. Generated private env UI/repository passwords; config/cache/log volumes; anonymous401 and saved Basic200 prove UI access only. | Not run. Repository choice, source mounts, snapshot, isolated restore remain explicit pending gates. |
| Syncthing 2.1.4 | [Official image guide](https://github.com/syncthing/syncthing/blob/main/README-Docker.md): PUID/PGID, `/var/syncthing` volume, optional sync/discovery ports. Fixed own-container CLI reads key privately; checkpointed PATCH creates GUI auth, saved Basic login and key readback verified separately. | Not run. Peer and authorized file round-trip remain pending; no device shares approved. |
| Caddy 2.11.4 | [Image Dockerfile](https://github.com/caddyserver/caddy-docker/blob/master/2.11/alpine/Dockerfile): root image can read reviewed mode0600 config; admin disabled; health response only, data/config volumes. No public proxy/certificate claim. | Registry digest resolved; remaining checks pending approval. |

## Exact proposed fresh batch (not applied)

Read-only CLI plan resolved all eight pinned tags to immutable registry digests
and passed exact host/port/resource preflight. Root is
`/tmp/selfhost-data-audit-20261003.Cl5SEn` (mode 0700), project `data-audit`,
owner directory `<root>/.selfhost/shared/data-audit`, plan ID
`6c9a75815378c774`. Loopback ports: Grafana 18700, Valkey 18701,
PostgreSQL 18702, Caddy 18703, Vector 18704, Prometheus 18705,
VictoriaMetrics 18706, Loki 18707. Only recipe-owned storage and generated
secret/config files; no existing project adopted.

Containers are `data-audit-APP-1` for the eight listed app IDs. Networks are
`data-audit-front` and `data-audit-APP-private`. Named volumes are
`data-audit-caddy-data`, `data-audit-caddy-config`, `data-audit-grafana-data`,
`data-audit-loki-data`, `data-audit-postgresql-database`,
`data-audit-prometheus-data`, `data-audit-valkey-data`, and
`data-audit-victoria-metrics-data`. Vector has only its owned generated config.

Exact apply approval:
`SHARED-APPLY:data-audit:0ed1d57d20ce40de5fd7b326a49dd83e1a9291723112afb26b1109eca22c2b02`.
Approval is a review token, not user consent. Fresh apply, setup action approvals,
same-owner replay, and scoped restart still require the requested approval.
No inference/model download, backup source/repository writes, public ingress,
host DNS modification, device sharing, or Homarr publication is in this batch.
