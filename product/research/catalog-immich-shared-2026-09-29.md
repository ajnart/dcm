# Immich v3.2.2 shared first account

The recipe keeps its `api-first-admin` contract so the standalone `app plan`/`app onboard`/`app close-setup` path remains valid. The adapter preserves that original branch for non-shared owners. For a shared owner it checks the pinned server's `GET /api/server/config` `isInitialized` value, checkpoints before its one-time `POST /api/auth/admin-sign-up`, and verifies the generated saved password with `POST /api/auth/login`. It refuses an already initialized instance without its own checkpoint, and refuses a blind retry after an ambiguous signup. The shared unit status builder must recognize this exact `api-first-admin` recipe as an email administrator (`admin@example.test`) with its generated password file; without that shared-engine compatibility, shared setup cannot reach the adapter.

This is **first-account verification only**, not complete Immich acceptance. The shared recipe still sets `IMMICH_ALLOW_SETUP=true`. Immich documents that setting it to `false` disables `/auth/admin-sign-up` and `/admin/database-backups/start-restore`. The shared SetupContext can send HTTP requests and save checkpoints but cannot safely update and recreate the exact shared Compose owner. The standalone `app close-plan` / `app close-setup` path applies to a different owner. Setup therefore reports `admin-login-verified-setup-open` and `setupClosed: false`; shared-owner setup closure requires a separately reviewed exact-project Compose change. Photo round-trip, restart persistence, and backup restore remain unverified.

Sources (pinned where API behavior is version-specific):

- [v3.2.2 auth controller](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/auth.controller.ts): login and first-admin routes.
- [v3.2.2 auth DTO](https://github.com/immich-app/immich/blob/v3.2.2/server/src/dtos/auth.dto.ts): signup request and login response fields.
- [v3.2.2 auth service](https://github.com/immich-app/immich/blob/v3.2.2/server/src/services/auth.service.ts): admin creation and password verification.
- [v3.2.2 server controller](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/server.controller.ts): server config route.
- [Immich environment variables](https://docs.immich.app/install/environment-variables/): setup-disable effect.
- [Immich post-install guide](https://docs.immich.app/install/post-install/): first registered user is administrator.
