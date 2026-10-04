# Actual Budget catalog assessment (2026-09-29)

## Upstream contract

- The official Docker guide publishes `ghcr.io/actualbudget/actual` or Docker Hub's `actualbudget/actual-server`, serves container port 5006, and persists both `server-files` and `user-files` under `/data`. A private recipe should bind host `127.0.0.1` and persist `/data`. [Docker guide](https://actualbudget.org/docs/install/docker/)
- Release `v26.9.0` exists; the catalog pins `ghcr.io/actualbudget/actual:26.9.0`. [Upstream releases](https://github.com/actualbudget/actual/releases/tag/v26.9.0)
- Actual's first-run server credential is a **password, without a username**. The optional budget end-to-end encryption password is separate. [Sync guide](https://actualbudget.org/docs/getting-started/sync/) [Pinned password implementation](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/accounts/password.js)
- The pinned server mounts account routes under `/account`. `GET /account/needs-bootstrap` returns `data.bootstrapped`; `POST /account/bootstrap` accepts `{password}` and returns a token; `POST /account/login` independently verifies `{password}`; `GET /account/validate` with `x-actual-token` returns `validated`, `permission`, `userName`, and `loginMethod`. The bootstrap guard rejects a second password bootstrap as `already-bootstrapped`. [Server route mount](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/app.ts) [Account routes](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/app-account.js) [Bootstrap guard](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/account-db.js) [Token validation](https://github.com/actualbudget/actual/blob/v26.9.0/packages/sync-server/src/util/validate-user.ts)
- The documented password-reset script is interactive inside the container, not a first-run injection contract. The server configuration page does not document a server-password `*_FILE` bootstrap setting. [Reset guide](https://actualbudget.org/docs/troubleshooting/reset_password/) [Server configuration](https://actualbudget.org/docs/config/)

## Catalog decision

The pinned routes support a one-time headless password-only setup with independent login and admin-session validation. The app-owned v2 recipe and adapter use a `manual-first-password` onboarding shape, generated private password file, and private loopback port. This requires the shared schema and status/handoff engine to support `manual-first-password` without inventing a username; until that common primitive is present and validated, the recipe must not be offered as installable. A Compose start alone is not acceptance.

Live v26.9.0 image behavior remains unverified. Keep budget data backup/restore, private access, budget creation, and restart persistence as distinct gates.
