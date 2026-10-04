# Stalwart headless helper

## Consumed shared administration route

The app's `derived-recipe.ts` and `setup.ts` now implement an explicit
`administration-only` shared route. Install inputs require `hostname`, `domain`
and `scope=administration-only`; setup inputs repeat the reviewed hostname and
domain. This does not replace the staged recovery-closure helper below.

Only management TCP 8080 is published on loopback. Owned configuration/data
volumes use the pinned image UID/GID 2000. `STALWART_RECOVERY_MODE=1` stays
enabled; **no** `STALWART_RECOVERY_ADMIN` value is injected. Fresh config absence
and the current-start source-backed native bootstrap log block are checked.
The permanent administrator password returned by `x:Bootstrap/set` replaces
the private handoff placeholder synchronously in the transport; the file and
directory are fsynced before the returned response reaches the app adapter.
A mode-0600, secret-free capture receipt binds the credential digest and
identity to its exact saved owner. Missing/lost capture remains unresolved,
never blindly replayed.

A separately approved, checkpointed restart affects only the owned Stalwart
service and activates the captured administrator while retaining recovery
mode. Interrupted restart is inspected through administrator readback rather
than replayed. The generated bootstrap login exists only in the old process;
its temporary password is never exported. No recovery-admin override is left
in the saved environment. Setup then creates one full inherited-administrator
management key, captures it and its receipt synchronously, and verifies exact
domain/account/role, wrong-password rejection and key identity/scope. Interrupted
readback resumes the saved credentials without recreating them.

`administration-verified` means only the private first-account/key baseline.
The report explicitly retains `recoveryClosure=pending-native-listener-policy`,
`mailDelivery=pending`, `nativeTls=pending`, unchanged DNS and unverified restart
persistence. Do not remove recovery mode until separately approved native
listener policy and HTTPS closure are implemented: normal startup inserts
default native listeners when none exist. Mail delivery, anti-abuse, intended
client access and persistent mail workloads remain separate acceptance gates.

Pinned source: [native bootstrap credentials](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/store/src/build/registry.rs),
[bootstrap writes](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs),
[default insertion](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/common/src/manager/defaults.rs),
[recovery listener policy](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/common/src/config/server/listener.rs).

Focused source fixture: `packages/cli/tests/stalwart-shared-setup.test.ts`.
No Docker, real deployment or mail acceptance was performed.

## Older staged recovery-closure helper

`headless.ts` exports `bootstrapStalwart(context, intent)`. It is a concrete,
callable first-administrator/configuration helper, **not** a discovered
`setup.ts`, shared recipe, CLI route, or mail-delivery acceptance claim.

`createStalwartApiKey(context, intent)` composes that bootstrap proof with one
separately approved management-key creation. Its additional `apiKeyJournal`
uses the same exact owner and exclusive lease, with durable compare-and-set
attempt/capture/ready phases. It requires no user-supplied license or API key.

`recipe.ts` now exports `compileStalwartRecipe` and
`setupStalwartPrivateAdministration`: an app-local immutable-image/private-admin
descriptor and owner-lease bridge to this helper, not catalog discovery or a
normal install/setup route. It selects only loopback management 8080,
configuration/data volumes, and logs under `/var/lib/stalwart/logs/`.
Its exact two-key recovery-removal descriptor needs checked shared transition
facilities. The shared private-environment transition can detach a source-owned
service env file and remove static recovery mode, but the staged bridge does not
yet bind that review/apply operation or its captured-administrator proof.
Review the staged boundary in
`research/catalog-audits/stalwart-recipe-20261003.md` from the repository root.
Before closure, inspect effective native listener/network isolation policy:
unpublished mail ports do not mean disabled listeners.
The helper now reads all `x:NetworkListener/get` objects with the permanent
administrator before closure and on every HTTPS verification. It requires a
nonempty, uniquely identified set of `http` listeners with nonempty bind sets.
SMTP, LMTP, IMAP, POP3, ManageSieve, malformed or absent listener policy stops
before recovery removal. It does not delete upstream defaults or configure
listeners automatically: that separate approved policy change and live socket
inspection belong to the exact owner. Registry readback is not live socket proof.

## Required owner facilities

The staged recipe bridge consumes the shared engine's `SetupContext.jmap`
contract. `SetupInspectionContext.jmap` exposes only read effects, rejects
checkpoint callbacks, and still validates the pinned `/get` method allowlist
through the transport. This reuses existing owner-status validation, bounded
loopback responses and saved CA/SNI-validating HTTPS curl transport. Recovery
selects only the saved loopback endpoint; HTTPS requires the supplied canonical
origin to equal the saved HTTPS target and never downgrades to HTTP. Only the
pinned helper's six `/get` methods are read-only POSTs. `x:Bootstrap/set` and
`x:ApiKey/set` need exact approval, a transport-owned no-replay checkpoint and
the app journal's `beforeSend` callback before sending bytes. Losing a returned
credential remains unresolved. This does not implement fresh volume/config
inspection, the exclusive owner lease, journal ownership, recovery lifecycle,
or native mail acceptance; the bridge is still staged and undiscoverable.

- Bind the reviewed v0.16.24 image, exact Compose owner/revision/manifest,
  app-owned mode-0700 private directory, RocksDB/log directories, and fresh
  **absence** of `config.json`. Do not prewrite a guessed bootstrap config:
  [upstream bootstrap](https://stalw.art/docs/configuration/bootstrap-mode/)
  is entered when `config.json` is absent; `x:Bootstrap/set` writes it.
- Provide owner-revalidated private `/api` requests to the exact recovery
  endpoint and previously approved canonical HTTPS origin. Reject redirects,
  validate hostname/certificate, bound responses, register secret values and
  suppress response bodies and errors. A saved, approved canonical HTTPS
  origin may supply this transport; a loopback-only transport cannot substitute
  for it. The recovery endpoint and canonical route must both stay owner-bound.
- Provide a durable owner-bound compare-and-set journal and exclusive setup
  lease. `journal.save` must reject concurrent/changed revisions. The request
  facility must obtain exact request approval and invoke `beforeSend` before
  sending mutation bytes. A failed or lost once-returned bootstrap response is
  unresolved, never replayable.
- Implement exact approved start, recovery wait, and recovery-removal/restart
  facilities. Startup must consume the helper's mode-0600 `recovery.env`, not
  arguments or logs. Removal must remove both `STALWART_RECOVERY_MODE` and
  `STALWART_RECOVERY_ADMIN` from saved runtime configuration and the running
  app, restart only that service, and inspect their absence. Keep the separate
  mode-0600 `recovery-password` file for rejection proof on resume; it is not
  an active credential or a handoff password.
- Establish the canonical HTTPS route before removal. Because recovery mode
  serves only HTTP management, this requires an existing, explicitly approved
  private TLS edge bound to the same owner during staging. No new proxy, TLS,
  DNS, published port, or public ingress is authorized by this helper.

The helper generates and durably captures recovery credentials, explicitly
selects internal directory/RocksDB/default auxiliary stores/manual DNS, disables
automatic ACME and DKIM work, verifies the Bootstrap singleton, checkpoints
the exact `x:Bootstrap/set`, and synchronously fsyncs the once-returned permanent
password and its private directory before any subsequent await. It then proves
wrong-password rejection, effective server/domain settings and the permanent
`User` account's `Admin` role. After scoped recovery removal/restart it repeats
HTTPS proof and requires HTTP 401 for the old recovery login. Interrupted cleanup
is observed, not automatically replayed.

Ordinary output reports only the permanent password file path. It proves
administrator/configuration access through the existing TLS owner route, not
native mail TLS, DNS authentication, SMTP/IMAP, mailbox persistence, anti-abuse,
external delivery, backup or restore. No installable recipe should be promoted
until these owner facilities and fresh-instance acceptance exist.

## Management credential extraction

After permanent-admin/recovery closure succeeds, use that administrator to
inspect `x:ApiKey/get` with `ids: null`. Refuse existing keys whose ownership
is unknown. Obtain exact approval for `x:ApiKey/set` with one `selfhost` create
entry, description `selfhost shared-owner management`, `allowedIps: {}` and
`permissions: {"@type":"Inherit"}`. This is a full administrator management
credential, not a mail-protocol password. Its scope must appear in review.

Persist the attempted phase before sending bytes. The pinned handler returns
`created.selfhost.id` and `created.selfhost.secret` once. Immediately write
both to mode-0600 `management-api-key.json`, fsync the file and private directory
before any subsequent await or request. The `API_` value encodes two big-endian
32-bit IDs plus 20 random secret bytes as unpadded base64url. Readback cannot
recover it: losing the response requires operator reconciliation, never a
second blind create.

Verify the saved key with Bearer authentication and `x:ApiKey/get` for its exact
ID, including the description, inherited scope and empty allowed-IP set. The
helper reports the private JSON path, never its secret. Resume repeats bootstrap
closure proof and bearer readback without creating another key. No secret is
in catalog data, Compose, logs, commands or the ordinary report.

## Full mail-server activation boundary

The shared recipe supports mail ports and private environment values, but
`SetupContext` now exposes the proven JMAP transport but still lacks the
remaining owner facilities listed above: fresh-config
inspection/start, private capture/journals and recovery transition. Its generic
`apply` explicitly refuses shared-owner mutations. Bind these through the owner
before registering an installable adapter.

The helper's HTTP-only listener policy must also become a reviewed native-mail
policy with live isolation proof before enabling SMTP/client protocols.
Management HTTPS is not native mail TLS or delivery acceptance. Keep the full
mail-server purpose and its DNS, anti-abuse, mailbox, persistence and recovery
checks; a management-only recipe does not complete that purpose.

## Pinned protocol evidence

- [v0.16.24 Bootstrap handler](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/bootstrap.rs):
  singleton update, internal administrator creation and
  `updated.singleton.{username,secret}`.
- [v0.16.24 registry structures](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/registry/src/schema/structs.rs):
  exact tagged store/directory/role variants and bootstrap properties.
- [Bootstrap API](https://stalw.art/docs/ref/object/bootstrap/),
  [Account API](https://stalw.art/docs/ref/object/account/),
  [SystemSettings API](https://stalw.art/docs/ref/object/system-settings/),
  [Domain API](https://stalw.art/docs/ref/object/domain/): `/api`,
  `urn:ietf:params:jmap:core`, `urn:stalwart:jmap`, `x:*` methods.
- [Recovery mode](https://stalw.art/docs/configuration/recovery-mode/):
  recovery administrator bypasses normal directory authentication even outside
  recovery mode; both temporary variables must be removed.
- [NetworkListener API](https://stalw.art/docs/ref/object/network-listener/)
  and [v0.16.24 listener schema](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/registry/src/schema/structs.rs):
  `x:NetworkListener/get`, `protocol`, and nonempty `bind` socket-address set.
- [v0.16.24 credential mapping](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/jmap/src/registry/mapping/account.rs):
  server-generated ApiKey, hash at rest and once-returned `created.*.secret`.
- [v0.16.24 credential codec](https://github.com/stalwartlabs/stalwart/blob/v0.16.24/crates/common/src/auth/credential.rs):
  exact `API_` encoding and parsing.
- [ApiKey API](https://stalw.art/docs/ref/object/api-key/) and
  [API-key authentication](https://stalw.art/docs/auth/authentication/api-key/):
  credential fields, permission modes and management-only authentication.

Helper validation: only `packages/cli/tests/stalwart-headless.test.ts` and a Bun
build of `headless.ts`. The app-local compiler/bridge has its separate focused
`packages/cli/tests/stalwart-recipe.test.ts` fixture and `recipe.ts` build.
Synthetic fixtures only; no Docker, DNS or mail workload.
