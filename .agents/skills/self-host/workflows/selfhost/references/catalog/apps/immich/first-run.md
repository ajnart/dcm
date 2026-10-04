# Immich v3.2.2 shared first-admin closure

Checked 2026-10-03 against the recipe's pinned upstream version.

The shared adapter can prove intrinsic first-admin closure without changing
`IMMICH_ALLOW_SETUP` or submitting an extra signup attempt:

- [`AuthController.signUpAdmin`](https://github.com/immich-app/immich/blob/v3.2.2/server/src/controllers/auth.controller.ts)
  declares the admin-signup route as public with `setup: true`.
- [`AuthGuard.canActivate`](https://github.com/immich-app/immich/blob/v3.2.2/server/src/middleware/auth.guard.ts)
  checks `requireSetupAvailable()` before allowing a public route.
- [`BaseService.isSetupAvailable`](https://github.com/immich-app/immich/blob/v3.2.2/server/src/services/base.service.ts)
  requires both the setup environment switch and absence of an administrator.
  Its requirement check rejects a closed setup route.
- [`UserRepository.hasAdmin`](https://github.com/immich-app/immich/blob/v3.2.2/server/src/repositories/user.repository.ts)
  looks for a non-deleted administrator.
- [`ServerService.getSystemConfig`](https://github.com/immich-app/immich/blob/v3.2.2/server/src/services/server.service.ts)
  derives `isInitialized` from the inverse of that same setup predicate.

Thus a trusted signup checkpoint, successful exact saved administrator login,
verified saved scoped Homarr key, and final `GET /api/server/config` readback
with `isInitialized: true` prove first-admin signup is unavailable at that point.
`isInitialized` alone is insufficient: disabling the environment switch also
sets it without establishing that an administrator exists.

The shared result records `setupClosure: intrinsic-first-admin`, not an
environment transition. Existing open account/key checkpoints resume with
readback; already initialized instances without a trusted checkpoint are not
adopted. Uncertain signup resumes only after initialization readback and saved
admin login; uncertain key creation without its saved one-time secret is not
replayed. No rejection probe is sent to the signup route.

This is current first-account closure, not irreversible closure if the last
administrator is later deleted. It does not prove photo function, mobile backup,
storage, restart persistence, recovery, or live-image acceptance. The separate
standalone contract is unchanged.
