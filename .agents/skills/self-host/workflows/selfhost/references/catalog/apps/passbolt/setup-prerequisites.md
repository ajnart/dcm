# Passbolt CE setup boundary

The derived shared recipe requires a stable canonical HTTPS origin, approved
private TLS route, SMTP host/port, explicit `smtp-auth=none`, sender email/name
and initial server-key email/name. Only an owner-approved no-auth STARTTLS relay
is supported; authenticated SMTP still needs private credential transport.
Pinned SMTP configuration defaults username/password to null. Separate generated
database user/root passwords and persistent database, server-GPG and JWT volumes
are not client credentials. Never change enrolled origins or regenerate keys on resume.

`setup.ts` consumes the real shared-owner transport and bounded OpenPGP custody
worker. Setup additionally requires the first owner's email/given/family names
without a manual server-fingerprint prompt. The native flow is:

1. Read `/auth/verify.json` only through the exact approved same-owner HTTPS route
   and trusted CA. Validate the public key against its real fingerprint and save
   that first-use pin in the exact checkpoint before registration. Every resume
   rejects changed server keys; there is no automatic re-pin or rotation path.
   This is owner-TLS-bound first-use trust, not a plaintext/discovered-endpoint pin.
2. Save approved encrypted client key, passphrase and recovery custody durably
   in the owner-only file before activation. Resume reuses that exact identity.
3. Under the exact registration approval, execute pinned `users_index` as
   `www-data` and require its exact empty-organization result before the write
   checkpoint. Existing non-guest users (including inactive/deleted identities),
   errors and unrecognized/localized output block without revealing user data.
   Then execute pinned `register_user` argv as `www-data` after the before-send
   checkpoint. Parse and save its one-time invitation synchronously
   to the transport-owned mode-0600 file before any output or await. Unknown/lost
   output stops automatic registration replay; it is not an admin password/API key.
4. Read native `/setup/start/<user-id>/<token>.json`; verify exact inactive identity.
   Submit `authentication_token.token` and `gpgkey.armored_key` to native
   `/setup/complete/<user-id>.json` only after separate approval/checkpoint.
5. Prove server private-key possession with GPGAuth stage0; decrypt and verify
   the server-signed stage1 challenge; submit the exact stage2 nonce. Read
   `/users/me.json` and require the saved ID/email, active admin role and client
   fingerprint. Keep cookies/challenges private and stable while approval is pending.

An attempted activation is never replayed. Resume authenticates the same saved
key to reconcile success; failure requires inspection. Key/passphrase bytes never
enter process arguments, ordinary status, public checkpoints or API-key storage.
Private handoff is native encrypted-key/passphrase/recovery custody, not a local
username/password login. The owner must privately import the native key into the
intended browser extension or other official client; import is not proven here.

The empty-organization check proves observed first-run freshness, not an atomic
lock. Upstream `register_user` permits another administrator; external concurrent
administration between the native read and registration must be excluded by the
owner. Manually onboarded owners are not automatically adopted or duplicated.

`gpg-administrator-verified` means native enrollment/login/key readback, not full
vault acceptance. Actual SMTP delivery and time synchronization, intended-client
DNS/TLS, authorized encrypted resource save/decrypt, restart persistence and
isolated full restore remain explicit gaps. Discovery support remains unchanged:
source implementation and focused fixtures do not prove a live deployment.

Sources checked against Passbolt API v5.16.0:

- [Official CE Docker guide](https://www.passbolt.com/docs/hosting/install/ce/docker/)
- [Pinned registration](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/RegisterUserCommand.php)
- [Pinned user-list freshness check](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Command/UsersIndexCommand.php)
- [Native routes](https://github.com/passbolt/passbolt_api/blob/v5.16.0/config/routes.php)
- [Activation service](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Service/Setup/AbstractCompleteService.php)
- [GPGAuth stages](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Authenticator/GpgAuthenticator.php)
- [Server public-key endpoint](https://github.com/passbolt/passbolt_api/blob/v5.16.0/src/Controller/Auth/AuthVerifyController.php)
- [Official client setup](https://www.passbolt.com/docs/user/quickstart/browser/first-setup/)
- [Full backup boundary](https://www.passbolt.com/docs/hosting/maintenance/backup/from-docker/)
