# Vaultwarden shared deployment boundary

Checked 2026-10-03 against Context7 `/dani-garcia/vaultwarden` and primary pinned
1.37.3 source. No Docker, image pulls, browser sessions, live account writes,
private state or credentials were accessed.

## Reuse and source changes

The existing standalone CLI and household browser helper already own pinned
signup, attempt-ledger, protected password transport, fresh-login reconciliation,
registration closure and recovery gates. They remain unchanged for their saved
owners; creating a second standalone owner is not a shared setup fallback.

The new v2 recipe uses that same publisher/version and shared project's existing
image-digest, loopback port, `/data` volume and generated mode-0600 credential
preparation. It preserves closed registration and invitations, leaves the domain
whitelist at its upstream empty default, and disables the separate server admin.
Persisted policy overrides still require readback. The generated
file is the future vault master password, not a server environment secret.
No account email or API key is invented.

The generic `official-client-first-email` kind is validated in the catalog and
schema without hard-coding Vaultwarden. It requires one generated master password
that is not bound into server environment/configuration. Shared status and
handoff expose `username: null`, `email: null`, `loginVia: official-client-email`,
`credentialUsage: generated-master-password` and pending enrollment; no saved
administrator identity is inferred from the file.

The app-owned `deriveCanonicalEnvironment` exports only `DOMAIN` for an exact
approved HTTPS origin. `/api/config` readback verifies publisher identity and all
client environment endpoints plus effective signup-disabled metadata. This
concrete helper supplies the missing Vaultwarden canonical-origin contract to the
same-owner route compiler; it never creates or mutates a TLS owner itself.

## Remaining gates

Root transport/lifecycle code must apply the canonical helper through a reviewed
same-owner transition and route all setup requests through the saved CA-verified
origin. A helper export alone is not a completed route. Intended-client DNS/trust
is separate from the agent's CA-aware request.

First-owner enrollment remains explicitly incomplete. The server's registration
model expects client-derived KDF/authentication material and a wrapped user key;
this adapter does not duplicate that cryptography or send plaintext to a guessed
signup endpoint. `ready` remains false even after canonical configuration readback.
The bounded official-client enrollment/unlock interface, separate signup-window
approval, effective invitation/override inspection, registration closure, scoped
restart and isolated recovery still need their own owner-compatible route.

## Validation

The focused `vaultwarden-shared-setup.test.ts` fixture checks single-owner closed
deployment, persistent volume, no server password/token binding, generated 0600
master-password preservation on resume, exact origin rejection/readback, no
plaintext in adapter output, HTTP rejection before any request and no readiness
promotion from metadata or asserted login flags. Catalog validation rejects an
invented identity, a server-bound master password and owner-issued payloads for
this generated credential kind. Validated recipes pass the shared compiler and
pure Compose planner. The fixture and adapter/catalog/shared-unit builds passed
on Bun 1.4.0. This is synthetic source proof,
not fresh-instance or encrypted-client acceptance.

Sources: [container shape](https://github.com/dani-garcia/vaultwarden/wiki/Starting-a-Container),
[HTTPS](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-HTTPS),
[pinned DOMAIN/invitation settings](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/.env.template),
[effective client config](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/mod.rs),
[client registration models](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/accounts.rs),
[whitelist policy](https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users).
