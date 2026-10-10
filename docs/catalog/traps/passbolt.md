# Passbolt traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `passbolt-db`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- The derived shared recipe binds explicit SMTP relay, sender, server-key and HTTPS identity choices before start and generates private database passwords. It supports only an owner-approved no-auth STARTTLS relay. Native first-admin enrollment/login is source-implemented; time synchronization, SMTP delivery, client import, encrypted-vault acceptance and recovery remain independently unverified.
- Working SMTP and time sync are installation prerequisites; test delivery of a real registration/recovery email independently of container or HTTP health.
- First-admin creation uses the official register_user command with an owner-selected email, first name, last name, and admin role. It returns a one-time setup URL, not a password; the current headless HTTP onboarding patterns cannot safely claim completion of the browser extension, owner passphrase, and recovery-kit flow.
- Preserve the database, server GPG keys, configuration, and the official Compose JWT volume across recreation. A database-only backup or container restart is not a recovery drill.
- Changing the full base URL after users enroll can unlink browser extensions.
- Native setup captures the pinned www-data register_user invitation privately, saves encrypted client-key/passphrase/recovery custody before activation, and verifies the exact administrator via server-key-verified GPGAuth. It never creates a fake local password or API key; SMTP delivery, official-client key import and encrypted-vault acceptance remain separate.
- Official CE tag 5.16.0-1-ce was verified through publisher metadata on 2026-10-03: index sha256:dc7298c2847e406154beea5c4c82062828e0b1690d1d9869b2dbeae6f6e70bfc with Linux amd64, arm64 and arm images. Re-resolve and bind the selected platform digest before apply; this metadata proves neither a running server nor encrypted-client acceptance.
- Private self-signed HTTPS is documented; public DNS and ACME are not mandatory. Stable private name resolution and intended-client certificate trust still need evidence. A generated application password cannot substitute for the owner's GPG key/passphrase and recovery custody.
- The documented Go CLI requires an already-enrolled private key and passphrase; configure is not enrollment. The upstream Go library's SetupAccount returns the generated private key only after setup completion, so a direct wrapper risks key loss after activation. A reviewed client runtime must persist approved key/recovery custody before setup completion and reconcile the saved user/key after ambiguous outcomes.

## Security

- Require an owner-chosen, stable private HTTPS origin with trusted TLS and matching APP_FULL_BASE_URL before registration or client use; do not substitute a loopback HTTP URL or publish 80/443 without separate edge approval.
- Keep database and SMTP credentials, server GPG and JWT keys, first-registration link, recovery kit, and administrative access private; back up the database, GPG keys, and configuration together and prove an isolated restore.
