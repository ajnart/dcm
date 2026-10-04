# Self-host defaults: Immich, Vaultwarden, and Docmost

- Checked at: `2026-09-25`
- Status: `warn` — upstream installation evidence is strong; strict image immutability and Docmost full-restore procedure need follow-up.
- Browser session: not used (public documentation/repository reads only)
- Session closed: not applicable
- Domain allowlist: `docs.immich.app`, `github.com`, `raw.githubusercontent.com`, `docmost.com`, `homarr.dev`
- Confidence: high for current upstream versions and documented Compose topology; medium for full deterministic deployment because only Immich's Compose dependencies are digest-pinned upstream.

## Scope

Read-only review of first-party installation, configuration, release, API, backup, and Homarr integration references. No Docker, host access, authentication, `.env`/`.sessions`/credential reads, or live mutation. Environment variable names are recorded; values and bind-mount sources are intentionally omitted.

## Sources

| Role | Canonical sources | Link result | Checked |
| --- | --- | --- | --- |
| official / image publisher — Immich | [latest release](https://github.com/immich-app/immich/releases/latest), [v3.2.2 Compose](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/docker/docker-compose.yml), [v3.2.2 environment reference](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/docs/docs/install/environment-variables.md) | pass; release redirects to `v3.2.2`; tagged raw files fetched | 2026-09-25 |
| official — Immich operations | [requirements](https://docs.immich.app/install/requirements/), [first-user setup](https://docs.immich.app/administration/user-management/), [versioned OpenAPI](https://github.com/immich-app/immich/blob/v3.2.2/open-api/immich-openapi-specs.json), [upgrading](https://docs.immich.app/install/upgrading/), [backup and restore](https://docs.immich.app/administration/backup-and-restore/) | pass; pages and tagged spec checked | 2026-09-25 |
| official / image publisher — Vaultwarden | [latest release](https://github.com/dani-garcia/vaultwarden/releases/latest), [upstream Compose example and image registries](https://github.com/dani-garcia/vaultwarden), [v1.37.3 environment template](https://raw.githubusercontent.com/dani-garcia/vaultwarden/1.37.3/.env.template) | pass; latest redirects to signed release `1.37.3`; tagged raw file fetched | 2026-09-25 |
| official — Vaultwarden operations/API | [backup guide](https://github.com/dani-garcia/vaultwarden/wiki/Backing-up-your-vault), [HTTPS guidance](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-HTTPS), [maintainer API compatibility answer](https://github.com/dani-garcia/vaultwarden/discussions/4210) | pass; pages fetched | 2026-09-25 |
| official / image publisher — Docmost | [latest release](https://github.com/docmost/docmost/releases/latest), [v0.96.0 Compose](https://raw.githubusercontent.com/docmost/docmost/v0.96.0/docker-compose.yml), [release image-tag workflow](https://github.com/docmost/docmost/blob/main/.github/workflows/release.yml) | pass; latest redirects to `v0.96.0`; tagged raw file and publisher workflow fetched | 2026-09-25 |
| official — Docmost operations/API | [installation](https://docmost.com/docs/installation), [configuration](https://docmost.com/docs/self-hosting/configuration), [API](https://docmost.com/docs/user-guide/api), [import/export](https://docmost.com/docs/user-guide/import-export) | pass; pages fetched | 2026-09-25 |
| official — Homarr | [integration catalog](https://homarr.dev/docs/category/integrations/), [Immich integration](https://homarr.dev/docs/integrations/immich/), [integration model](https://homarr.dev/docs/management/integrations/) | pass; pages fetched | 2026-09-25 |

## Findings

### Immich

The latest upstream release is **v3.2.2**. Use the Compose file from that release, not `main`: upstream warns `main` may be incompatible with the latest release. The Compose template parameterizes the server and ML images, so set `IMMICH_VERSION` to `v3.2.2` for a release pin. The tagged file already pins Valkey and Immich's PostgreSQL image by digest. [Release](https://github.com/immich-app/immich/releases/latest) · [tagged Compose](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/docker/docker-compose.yml)

| Compose service | Image to use | Dependencies / persisted targets | Host port |
| --- | --- | --- | --- |
| `immich-server` | `ghcr.io/immich-app/immich-server:v3.2.2` | Valkey + database; `${UPLOAD_LOCATION}:/data` | `2283:2283` |
| `immich-machine-learning` | `ghcr.io/immich-app/immich-machine-learning:v3.2.2` | `model-cache:/cache` | none published |
| `redis` (Valkey) | `docker.io/valkey/valkey:9@sha256:70739f85ad2ee01a726a965584a0f94895f01b0c60b3cc8b0aeef11eaa6888cf` | internal cache/queue; no persistent volume in tagged file | none |
| `database` | `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23` | `${DB_DATA_LOCATION}:/var/lib/postgresql/data` | none |

Use `.env` names `IMMICH_VERSION`, `UPLOAD_LOCATION`, `DB_DATA_LOCATION`, `DB_PASSWORD`, `DB_USERNAME`, and `DB_DATABASE_NAME`; `DB_PASSWORD` is secret material. The first signup becomes the admin. Immich requires Docker Compose v2; upstream lists 6 GB RAM and 2 CPU cores minimum, supports `amd64`/`arm64`, and recommends local SSD—not network-share—Postgres storage. Since Immich v3, its `amd64` ML image requires x86-64-v2. [Environment variables](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/docs/docs/install/environment-variables.md) · [requirements](https://docs.immich.app/install/requirements/) · [user management](https://docs.immich.app/administration/user-management/)

Immich v3.2.2's versioned OpenAPI marks `signUpAdmin` **Stable**: `POST /api/auth/admin-sign-up` accepts `email`, `name`, and `password`, and returns `201`. It is public but setup-gated: `IMMICH_ALLOW_SETUP=false` or an existing admin disables this first-user path. That makes private, body-only, no-log API bootstrap a supported headless option; the browser remains a fallback. The reviewed API/deployment docs specify no numeric request quota; the operational compatibility limit is versioning: breaking API/deployment changes are intended to be major-version changes, and the server requires matching-major clients. [OpenAPI](https://github.com/immich-app/immich/blob/v3.2.2/open-api/immich-openapi-specs.json) · [controller](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/auth.controller.ts) · [environment](https://docs.immich.app/install/environment-variables/) · [upgrade policy](https://docs.immich.app/install/upgrading/)

Automatic database dumps are stored under `UPLOAD_LOCATION/backups`, but contain metadata only. A real backup must also capture uploaded originals and other required assets; upstream recommends a consistent snapshot, ideally stopping the server, or taking the database first and filesystem second. Versioned Compose plus a semver image pin and the two dependency digests is the strongest deterministic setup in this comparison. Read release notes before upgrading; downgrades are unsupported. [Backup/restore](https://docs.immich.app/administration/backup-and-restore/) · [upgrades](https://docs.immich.app/install/upgrading/)

### Vaultwarden

Latest upstream release is **1.37.3** (signed release tag). A minimal upstream Compose deployment is one container, with no external database required when using the default SQLite backend. Upstream publishes images through GHCR, Docker Hub, and Quay; the Docker Hub reference below follows its Compose example. [Release](https://github.com/dani-garcia/vaultwarden/releases/latest) · [upstream README](https://github.com/dani-garcia/vaultwarden)

| Service | Image to use | Dependencies / persisted target | Host port |
| --- | --- | --- | --- |
| `vaultwarden` | `vaultwarden/server:1.37.3` | SQLite default; optional MySQL/PostgreSQL; `./vw-data:/data` | upstream example: `127.0.0.1:8000:80` |

Relevant environment names are `DOMAIN`, `DATABASE_URL` (only if selecting another DB), `SIGNUPS_ALLOWED`, `ENABLE_WEBSOCKET` (notifications), and `ADMIN_TOKEN`. Leave the admin panel disabled unless needed; its token is a secret. HTTPS is required for the web vault's browser crypto APIs; upstream recommends TLS at a reverse proxy. Bootstrap is an interactive first account registration, not a seeded administrative account—plan a controlled signup window and then restrict registrations/invitations. [Compose and HTTPS guidance](https://github.com/dani-garcia/vaultwarden) · [environment template](https://raw.githubusercontent.com/dani-garcia/vaultwarden/1.37.3/.env.template) · [HTTPS](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-HTTPS)

API boundary: Vaultwarden is an unofficial Bitwarden-compatible server with a nearly complete **client** API. A maintainer explicitly says it does not implement Bitwarden's public API, apart from a small Directory Connector subset; do not assume third-party REST automation compatibility or official Bitwarden support. [Project README](https://github.com/dani-garcia/vaultwarden) · [maintainer answer](https://github.com/dani-garcia/vaultwarden/discussions/4210)

For SQLite, upstream's built-in `/vaultwarden backup` writes a consistent DB backup. Back up `db.sqlite3` **and** the separate attachments directory; also preserve `config.json` and RSA key files, and optionally Sends if existing Send attachments must survive. If restoring a `VACUUM INTO`/built-in backup, remove stale `db.sqlite3-wal` first; for a raw DB copy, preserve DB and WAL together. The official container does not include `sqlite3` or cron. Match server updates to Bitwarden client compatibility: release `1.37.0` was required for clients `2026.7.0+`; `1.37.3` includes auth/prelogin rate-limit and security fixes. [Backup guide](https://github.com/dani-garcia/vaultwarden/wiki/Backing-up-your-vault) · [1.37.3 release notes](https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.3)

### Notion/docs replacement: Docmost

**Recommendation: Docmost** for a docs-first collaborative Notion replacement. Its upstream describes it as a Notion/Confluence alternative and supplies a Compose stack using local file storage, PostgreSQL, and Redis; SMTP and S3/Azure storage are optional. The latest release is **v0.96.0**. The upstream release workflow publishes `docmost/docmost:<version-without-v>` and `latest`, so the exact application tag is `docmost/docmost:0.96.0`. This is three services, not a one-container/minimum-footprint wiki. [Latest release](https://github.com/docmost/docmost/releases/latest) · [tagged Compose](https://raw.githubusercontent.com/docmost/docmost/v0.96.0/docker-compose.yml) · [image-tag workflow](https://github.com/docmost/docmost/blob/main/.github/workflows/release.yml)

| Service | Pinned app / official baseline image | Dependencies / persisted targets | Host port |
| --- | --- | --- | --- |
| `docmost` | `docmost/docmost:0.96.0` (official Compose currently says `latest`) | PostgreSQL + Redis; `docmost:/app/data/storage` | `3000:3000` |
| `db` | official baseline `postgres:18` | `db_data:/var/lib/postgresql` | none |
| `redis` | official baseline `redis:8` | AOF enabled; `redis_data:/data` | none |

Required configuration names: `APP_URL`, `APP_SECRET` (random, at least 32 characters), `DATABASE_URL`, `REDIS_URL`, plus PostgreSQL's `POSTGRES_DB`, `POSTGRES_USER`, and secret `POSTGRES_PASSWORD`. Port 3000 should be loopback-bound or private behind the approved proxy; reverse proxies must permit WebSockets for real-time editing. Initial setup is a browser setup page; the first user becomes workspace owner. Health endpoint is `/api/health`. Its REST API is **Enterprise-only**; community self-hosting should not be planned around API automation. The documented Notion ZIP import is useful for migration, but the import page does not establish edition availability. [Installation](https://docmost.com/docs/installation) · [configuration](https://docmost.com/docs/self-hosting/configuration) · [API](https://docmost.com/docs/user-guide/api) · [import/export](https://docmost.com/docs/user-guide/import-export)

The official Compose's Postgres and Redis tags are major-only (`18`, `8`), and the service's application template is `latest`; replace these with version tags and preferably registry digests for deterministic deployment. Upstream documents space export to Markdown/HTML, but the reviewed docs did not provide a full-stack restore procedure. Operationally preserve and test restores for PostgreSQL and Docmost storage; the Redis volume has AOF enabled, so its rebuild/restore behavior should be confirmed before treating it as disposable. The latest release notes identify security fixes and recommend upgrading. [Compose](https://raw.githubusercontent.com/docmost/docmost/v0.96.0/docker-compose.yml) · [export](https://docmost.com/docs/user-guide/import-export) · [v0.96.0 release](https://github.com/docmost/docmost/releases/tag/v0.96.0)

Tradeoff: Docmost is a credible, modest Compose topology for collaborative docs, but not free Notion parity. Bases/table/Kanban and REST API access are paid features. If “lightweight” strictly means one process and no database/Redis, Docmost does not meet that stricter constraint. [Product introduction and editions](https://docmost.com/docs/) · [Bases feature](https://docmost.com/docs/user-guide/bases) · [API](https://docmost.com/docs/user-guide/api)

## Homarr integration support

Homarr's current official catalog has an Immich integration with Album Carousel and Server Stats widgets; creating it requires a scoped Immich API key. The integration model is separate from an app link/tile. The current catalog index has no dedicated Vaultwarden or Docmost integration entry, so treat those as app-link/tile-only unless the Homarr catalog changes. [Catalog](https://homarr.dev/docs/category/integrations/) · [Immich setup](https://homarr.dev/docs/integrations/immich/) · [integration vs app links](https://homarr.dev/docs/management/integrations/)

## Safety and redaction

- No user secrets or environment values were accessed or recorded; only variable names appear here.
- Redaction: not applicable to public docs; retained secret values: `0`.
- No raw browser payload, authenticated session, profile, cookies, HAR, or recording was used.

## Limitations

- Image version tags are not equivalent to immutable digests. Only the two non-app Immich images were digest-pinned in the reviewed upstream tagged Compose. Vaultwarden's registry digest and Docmost/Postgres/Redis digests were not resolved; strict content-addressed reproducibility remains open.
- Docmost's official Compose uses floating major/latest tags; exact dependency patch tags and a full backup/restore procedure need separate verification before production catalog promotion.
- Homarr support conclusions reflect its official docs catalog fetched on 2026-09-25; absence from the catalog is not proof that a future/custom integration cannot exist.
- No UI or runtime acceptance was performed.

## Conclusion

Immich and Vaultwarden have upstream-documented deployment and recovery paths and are suitable for focused Compose recipes with exact app versions. Docmost is the best match here for collaborative Notion-like docs, subject to three-service footprint, Enterprise-only API, and unresolved full restore guidance. Do not call the whole set fully deterministic until every image is pinned to a verified digest and Docmost recovery is tested.
