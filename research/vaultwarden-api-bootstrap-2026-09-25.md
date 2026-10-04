# Vaultwarden API bootstrap research

Date: 2026-09-25  
Scope: Auto-Stack's Vaultwarden bootstrap boundary; no live stack, Docker,
browser session, or secret access was used.

Context7 was queried first as required by the repository instructions, but its
monthly quota was exhausted. The conclusions below use the pinned repository
source plus official Vaultwarden and Bitwarden source/documentation instead.

## Version and source identity

The Auto-Stack bundle does not hard-code one Vaultwarden image. It requires an
explicit version tag and immutable digest in `--vaultwarden-image`
([CLI README](../packages/cli/README.md#L37-L46)). The reviewed upstream
compatibility target is Vaultwarden **1.37.3**, whose signed tag resolves to
commit `eb212e23fad88e6136723f43e5b73543fa7026d3`
([release](https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.3)).
That is a source/version pin, not an image digest; the image digest remains a
caller-supplied input.

## HTTP protocol findings

| Operation | Official route/protocol | Safe conclusion |
| --- | --- | --- |
| First account signup | Vaultwarden 1.37.3 exposes `POST /identity/accounts/register` and `/identity/accounts/register/finish` ([identity routes](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/identity.rs#L1058-L1145)). The payload contains KDF data, the master-password authentication hash, a wrapped user key, and optional asymmetric keys ([account models](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/accounts.rs#L80-L213)). | Technically possible over HTTP, but not a simple or stable “create user” API. The official client derives the master key, user key, wrapped key, and key pair before sending registration ([Bitwarden registration service](https://github.com/bitwarden/clients/blob/9f07c4b89012c273c48b08cbce0615ed4647d112/libs/auth/src/angular/registration/registration-finish/default-registration-finish.service.ts#L89-L196)). Do not hand-roll this in Auto-Stack. |
| Login/authentication | `POST /identity/accounts/prelogin/password` returns the KDF settings ([prelogin implementation](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/accounts.rs#L1336-L1369)); `POST /identity/connect/token` accepts the form-encoded password grant and device fields ([identity login](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/identity.rs#L59-L149)). | Deterministic HTTP authentication is possible only with a client-compatible derived master-password hash, device identity, and any required 2FA/device/email challenge. A 200 response proves authentication, not vault unlock. |
| Fresh login/unlock | The official Bitwarden client derives the master key before token login and then calls `unlockWithMasterPassword` after processing the token response ([password login](https://github.com/bitwarden/clients/blob/9f07c4b89012c273c48b08cbce0615ed4647d112/libs/auth/src/common/login-strategies/password-login.strategy.ts#L83-L126), [login strategy](https://github.com/bitwarden/clients/blob/9f07c4b89012c273b08cbce0615ed4647d112/libs/auth/src/common/login-strategies/login.strategy.ts#L117-L136)). | Unlock is client-side cryptography plus sync, not a server HTTP operation. Raw token acquisition or `/api/sync` must not be reported as “fresh login and unlock.” A pinned official Bitwarden CLI could be a future headless verifier: its docs support self-hosted server configuration, password login, and `bw unlock --passwordenv/--passwordfile` ([CLI docs](https://bitwarden.com/help/cli/)); that client version is not currently pinned or validated by Auto-Stack. |
| Registration closure | `signups_allowed` controls new registrations ([Vaultwarden config](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/config.rs#L617-L627)). Vaultwarden also has `POST /admin/config`, but it requires an authenticated admin session ([admin route](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/admin.rs#L828-L835)); the admin token creates a privileged JWT cookie ([admin wiki](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-admin-page#session-management)). | Safe headless closure is the existing Auto-Stack second Compose revision with `SIGNUPS_ALLOWED=false` (and its exact approval), not an ad-hoc admin-cookie call. Post-closure client login/unlock and registration-unavailable checks remain acceptance evidence. |

Vaultwarden's own README describes this as an alternative implementation of the
**Bitwarden Client API**, not the public Bitwarden API ([README](https://github.com/dani-garcia/vaultwarden/tree/1.37.3#features)). A maintainer explicitly says the public API is not implemented ([API compatibility discussion](https://github.com/dani-garcia/vaultwarden/discussions/4210#discussioncomment-8073117)). These endpoints should therefore be treated as versioned client-compatibility behavior, not a generic REST contract.

## Recommended Auto-Stack boundary

Keep the current two-phase contract:

1. Apply the dedicated Compose project with registration temporarily enabled,
   then stop at `browser-signup-required`.
2. Use the approved private HTTPS origin and official web client (currently
   `agent-browser`) to create the account, sign out, and perform a fresh sign-in
   and unlock. Record only non-secret evidence.
3. Plan and apply the exact no-registration Compose revision, then repeat fresh
   login/unlock and registration-closed checks.

This matches the current adapter's explicit method and evidence boundary
([plan facts](../packages/cli/src/vaultwarden.ts#L420-L457), [apply checkpoints](../packages/cli/src/vaultwarden.ts#L596-L650), [closure plan](../packages/cli/src/vaultwarden.ts#L653-L714)).

An HTTP-only bootstrap would require a separately pinned Bitwarden client/SDK
implementation, compatibility tests against the exact Vaultwarden image digest,
private password transport, and direct decrypted-vault acceptance. Until that
exists, do not replace the browser checkpoint with guessed registration HTTP or
claim `<10 min` completion from token/API health alone.

## Caveats

- `SIGNUPS_ALLOWED=false` does not inherently prevent invitations; the bundle's
  manifest also controls invitation policy and must be reviewed as an exact
  closure change.
- Email verification, 2FA, device verification, and future Bitwarden client
  cryptographic-state changes can add protocol steps even when the server routes
  remain present.
- No live runtime, image digest resolution, registration, login, or unlock test
  was performed in this research pass.
