# Vaultwarden: private password vault

Status: guided recipe, sources checked 2026-09-21; live onboarding remains
unverified. Explain that Vaultwarden works with compatible Bitwarden clients.
It is a shortcut-only app in the current Homarr catalog, not a live integration.

## Choices and identity

Ask for the account email if it is not already known. Do not turn the chosen
username into an invented email address. Generate a separate strong vault master
password; never reuse the media administrator password or a server admin token.
Keep it in the explicitly requested owner-only credential handoff. The user
must retain access to that handoff independently of this vault.

## Owned deployment

Use `selfhost-compose` for an owned project and `selfhost-ingress` for its
private HTTPS route. Resolve an immutable image digest from the official
`vaultwarden/server` repository before apply; record the source and digest.
Mount the exact owned persistent directory at `/data`. The official hardening
guide supports a non-root UID:GID; ensure this identity can write `/data`.
Use `ROCKET_PORT=8080` for an unprivileged container listener, and publish only
to the approved private/loopback address. Keep the optional admin page disabled
unless a separate server-administration task requires it.

Set `DOMAIN` to the approved user-facing HTTPS origin. Configure and test the
reverse proxy before onboarding. The web vault depends on browser WebCrypto;
loading its HTML over plain LAN HTTP does not prove it can create or unlock a
vault. Verify `window.isSecureContext` and `crypto.subtle` as booleans, and verify
the intended user's device trusts the certificate. Never treat a TLS-warning
bypass in the automation browser as client acceptance.

## First account and resume

On a fresh private deployment, permit registration only for the controlled
bootstrap interval. Open the web vault root, inspect current form metadata,
choose account creation, and enter the selected email/name plus the generated
master password and confirmation. Use private field-validated input; ordinary
snapshots must not contain populated credentials. Do not POST a plaintext
master password to a guessed server API: the official web client performs the
vault's cryptographic account setup.

After successful creation, sign out and sign in again through the web client.
Set `SIGNUPS_ALLOWED=false` and `INVITATIONS_ALLOWED=false` through the owning
Compose plan/apply flow, then verify the saved account still logs in and new
registration is disabled. Record the actual bootstrap path observed for the
pinned image. On resume, authenticate to the existing account; never re-enable
registration or reset an existing vault to recover an interrupted setup.

## Acceptance and handoff

- Persistent `/data`, the intended HTTPS origin, and client certificate trust.
- Fresh login and vault unlock using the selected account.
- Closed registration after bootstrap.
- Homarr shortcut points to the reachable origin; no API-key/widget claim.
- Encrypted export and isolated recovery evidence before migrating real vault
  contents. An empty test account does not establish recovery for real data.
- Private handoff records the account email, master password, URL, storage,
  deployment identity and the exact remaining recovery steps. No vault contents
  or credentials belong in the Homarr recap or ordinary report.

## Sources

- [Container deployment](https://github.com/dani-garcia/vaultwarden/wiki/Starting-a-Container)
- [Hardening guide](https://github.com/dani-garcia/vaultwarden/wiki/Hardening-Guide)
- [HTTPS and reverse proxy](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-HTTPS)
- [Disable registration](https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users)
- [Disable invitations](https://github.com/dani-garcia/vaultwarden/wiki/Disable-invitations)
