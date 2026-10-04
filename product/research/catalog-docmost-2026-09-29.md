# Docmost shared-catalog setup boundary (2026-09-29)

Source review only. No container or live Docmost instance was used.

## Established facts

- The [official installation guide](https://docmost.com/docs/installation) specifies Docmost, PostgreSQL, and Redis; port 3000; persistent `/app/data/storage`, PostgreSQL, and Redis data; `APP_SECRET` (at least 32 characters), `DATABASE_URL`, and `REDIS_URL`. It documents `/api/health` as a health endpoint and presents the first workspace/owner as a browser setup step.
- The [environment reference](https://docmost.com/docs/self-hosting/environment-variables) documents `APP_SECRET` and `DATABASE_URL` as environment variables, not `*_FILE` variables. The shared recipe's generated `secretEnvironment` can supply them through an owner-only env file, but operators with Docker inspect access can still see container environment secrets. A `postgres-url` binding can derive the database URL from one generated password.
- The existing standalone CLI pins `docmost/docmost:0.96.0` and implements a separate, approval-gated `POST /api/auth/setup` followed by fresh `POST /api/auth/login` verification (`packages/cli/src/docmost.ts`, owner-plan/owner-apply). The earlier [tagged-source review](../../research/docmost-api-bootstrap-2026-09-25.md) establishes route shape but explicitly did not exercise it against a running instance.
- The [official API guide](https://docmost.com/docs/user-guide/api) says REST API access requires an active Enterprise license. The Community setup and upload handlers in the pinned source are implementation routes, not a supported public Community API contract.

## Catalog decision

An inspectable three-service v2 recipe now pins Docmost v0.96.0, PostgreSQL 18, and Redis 8 to the [tagged official Compose](https://github.com/docmost/docmost/blob/v0.96.0/docker-compose.yml). It keeps only the web port on loopback, uses project-owned named volumes for app storage, database, and Redis data, and generates `APP_SECRET` and one database password through the shared secret-environment boundary. `APP_URL` derives from the exact selected loopback origin. The container environment remains visible to operators with Docker inspection access.

The source-pinned shared adapter creates the first owner using the documented example identity `admin@example.test` and the generated password, checkpoints before sending setup, and verifies a fresh password login. This batch deliberately fixes the email; a user-selectable identity needs a later shared handoff/input extension. On a lost setup response, the adapter tries only the saved credential, never replays setup. The pinned implementation is not a supported public Community API: the [official API guide](https://docmost.com/docs/user-guide/api) reserves REST API access for Enterprise. Source review and the standalone CLI flow do not prove this recipe's fresh-instance runtime behavior.

## Narrow promotion path

1. In an isolated disposable instance of the pinned image, verify `POST /api/auth/setup`, fresh `POST /api/auth/login`, and response/cookie handling through the shared HTTP transport. A lost setup response must fail closed or prove ownership via the saved credential.
2. Add a user-selectable first-owner email/name only with explicit shared onboarding, handoff, and checkpoint support. Keep page, attachment, restart, and isolated-restore acceptance separate.

This is a support/evidence gap, not a claim that the upstream route is absent or that browser automation is technically required.
