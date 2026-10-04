# Tracearr catalog review — 2026-09-30

Decision: retain discovery-only support. No shared recipe or headless setup adapter is published.

## Official evidence

- [Tracearr v2.5.1 release](https://github.com/connorgallopo/Tracearr/releases/tag/v2.5.1) is a stable version target, not proof of the matching image digest or the complete pinned Compose topology.
- [Docker Compose installation](https://docs.tracearr.com/getting-started/installation) recommends three containers: Tracearr, TimescaleDB, and Redis. It requires distinct 64-character hexadecimal `JWT_SECRET` and `COOKIE_SECRET` values; `BETTER_AUTH_SECRET` is optional but recommended. It recommends named volumes for database data and poster cache. The current documentation links a moving `main` Compose file, not a release-pinned file. Its PostgreSQL 18 example is new-install-only and must not be reused with older data volumes.
- [Environment reference](https://docs.tracearr.com/configuration/environment) documents mandatory `DATABASE_URL`, `REDIS_URL`, and signing secrets, and a `CLAIM_CODE` for the initial setup page. The code is printed in logs, so scraping it is not an acceptable private handoff.
- [Current upstream pg18 example](https://github.com/connorgallopo/Tracearr/blob/main/docker/examples/docker-compose.pg18.yml) uses the standard Tracearr image, TimescaleDB HA, Redis, a database password in both `POSTGRES_PASSWORD` and `DATABASE_URL`, and named volumes. It uses moving `latest` and Redis tags, so copying it unchanged would not be a pinned recipe.
- [Connect a Server](https://docs.tracearr.com/getting-started/first-server) says first access prompts sign-in or account creation. For Jellyfin/Emby, the operator creates a local Tracearr account and then supplies a server URL and API key; Plex and OIDC are separate identity flows. The page does not document a headless first-owner endpoint, payload, or safe replay semantics.

## Blocker and next proof

The shared engine supports generated PostgreSQL URL composition and owner-only secret-environment files; those solve database/secret plumbing, not onboarding. Before publishing `recipe.json` and `setup.ts`, inspect the **v2.5.1** source and matching image for the exact Compose dependencies, environment bindings, account-creation route and body, first-owner privilege rule, authenticated read-back, and replay behavior. Prove the first-account flow on a disposable private project, including interrupted-write recovery and restart. A browser wizard or generic Better Auth endpoint is not enough evidence for an approval-gated headless adapter. Media-server connection and session data are separate acceptance boundaries. The Homarr integration mapping is metadata, not proof of a working integration or widget. No Docker or live application checks were run.
