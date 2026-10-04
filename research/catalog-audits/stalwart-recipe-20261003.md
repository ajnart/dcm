# Stalwart staged recipe and bridge — 2026-10-03

The app-local `recipe.ts` compiler requires `stalwartlabs/stalwart:v0.16.24`
plus an explicit sha256 digest. It selects only loopback TCP management 8080,
image-default UID/GID 2000, and configuration/data named-volume descriptors at
`/etc/stalwart` and `/var/lib/stalwart`. Logs stay under the data volume.
It does not write `config.json`: fresh absence is checked by the owner, and
`x:Bootstrap/set` writes the configuration. Internal directory, RocksDB,
manual DNS, disabled ACME and disabled DKIM match the existing helper.

`setupStalwartPrivateAdministration` composes the existing durable bootstrap
and management-key helper under the owner's exclusive setup lease. It binds
the exact selected recipe to start/wait/inspection and recovery transition
facilities. Secrets are generated/captured by `headless.ts` in its mode-0600
files, never included in the compiler output or passed on argv.

## Recovery transition integration boundary

The descriptor requires removing **both** `STALWART_RECOVERY_MODE` and
`STALWART_RECOVERY_ADMIN` from saved and running configuration, preserving
the rejection-proof/password files, and recreating only `stalwart-mail`.
The bridge delegates this to the checked source-declared shared transition
owner; it does not edit Docker or implement a second lifecycle owner.

The current Linkwarden-style shared transition only supports replacing one
static non-secret environment value. It does not support atomically removing
two keys from a private env file. Therefore this compiler deliberately remains
app-local and staged: no `recipe.json`, `setup.ts`, catalog promotion or normal
CLI setup registration was added. A checked owner must implement this removal
through its existing review/revision approval/checkpoint/scoped recreate path.
It must not re-prepare the original recovery env after closure on resume.

Other required owner facilities remain exact fresh config absence, owned
volumes/private directory, durable CAS journals, request-effect approval,
bounded/redacted recovery transport and existing hostname/certificate-validated
canonical HTTPS transport. The private network must isolate unauthorized
container access. No published SMTP port does **not** prove disabled native
listeners: inspect effective listener policy before removing recovery mode.
DNS, native mail TLS, SMTP/client exposure, delivery, backup and restore remain
unverified and require separate authority/acceptance.

## Current primary-source checks

Context7 resolved Stalwart with `library` and checked recovery/bootstrap docs
through `/websites/stalw_art`. Its indexed security snippet says recovery admin
is only honored in bootstrap/recovery mode; the existing pinned-source audit
and dedicated recovery page establish that the recovery administrator bypasses
ordinary directory authentication. Do not depend on the inconsistent snippet:
remove both variables and require actual old-login HTTP 401 after restart.

- [Pinned Dockerfile](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/Dockerfile): runtime user, volumes, configuration path, exposed ports.
- [Pinned Bootstrap handler](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs): permanent-admin generation/return, internal directory, manual DNS and optional ACME/DKIM tasks.
- [Bootstrap mode](https://stalw.art/docs/configuration/bootstrap-mode/): missing config and temporary administrator.
- [Recovery mode](https://stalw.art/docs/configuration/recovery-mode/): recovery env and authentication override.

Validation is limited to `packages/cli/tests/stalwart-recipe.test.ts` and a Bun
build of `recipe.ts`. It is source/synthetic evidence, not Docker, live setup,
mail acceptance or evidence that the required owner bridge already exists.
Both passed with Bun 1.4.0: 3 focused cases and 22 assertions. No Docker,
deployment, live services, secrets, CI, commits or pushes were accessed.

## Narrow shared-owner removal seam

`packages/cli/src/lib/shared-private-environment-transition.ts` now provides
the common review/reconstruction step for detaching a whole service-local
private env file and removing exact recipe-declared static environment pairs.
`postFirstAccountPrivateEnvironment` declares the service, first-account gate,
the private binding names, and static name/value pairs to remove. It refuses
extra private bindings, shared/unowned env-file paths, owner drift and replay.
It changes only the selected service and binds the resulting manifest plus
previous revision to the existing `TRANSITION` approval shape.

The original mode-0600 env file is retained as **inactive** evidence; the saved
runtime manifest no longer references it. No credential bytes are rewritten.
The shared transition owner must still verify first-account proof, obtain the
exact revision approval, checkpoint, recreate only that service, and inspect
live absence of all removed keys. Saved selection reconstruction must apply
the same closure transformation, never reinject the original env-file path.

This module is not an alternate apply owner. Actual CLI transition dispatch,
bundled declaration registration and saved reconstruction remain integration
work owned by the shared engine. Stalwart also still needs its separate
fresh-config, journal, canonical JMAP transport and server-returned credential
bridges before a discoverable setup route can be registered.

The module's separate focused fixture passed 3 cases and 17 assertions with
Bun 1.4.0; its Bun build passed. No runtime file or live service was accessed.
