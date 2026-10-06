# Vaultwarden traps

## Pitfalls

- Compatibility and recovery are higher consequence than an ordinary web app.
- The built-in admin page is disabled without ADMIN_TOKEN; enabling it is separate from creating a vault owner and must not substitute for HTTPS or signup controls.
- SIGNUPS_ALLOWED=false closes ordinary registration, but organization invitations and admin invitations have separate behavior. A nonempty SIGNUPS_DOMAINS_WHITELIST and persisted config.json overrides must also be checked before claiming registration closure.
- The pinned server reads secret settings through documented source-level NAME_FILE support and rejects simultaneous NAME and NAME_FILE inputs. ADMIN_TOKEN may contain an Argon2id PHC hash, but enabling server administration is separate from creating or unlocking a vault account; keep it disabled unless explicitly needed.
- The shared recipe generates one owner-only master-password file but does not bind it into the server or enable ADMIN_TOKEN. Vault account registration requires the Bitwarden client's KDF, authentication hash and wrapped encryption key; a generic email/password POST or an admin login is not a compatible first-owner bootstrap.
- Applied private HTTPS and a stable canonical DOMAIN are prerequisites, not first-owner evidence. Shared setup still needs a separately pinned official-client enrollment and decrypted-unlock boundary. Keep the existing standalone signup/closure/recovery gate until that boundary exists; server health, a password-grant token, or an ADMIN_TOKEN session must never satisfy vault-account readiness.

## Security

- Require a verified private HTTPS origin before account creation or client use; keep administration private, registration closed outside a bounded first-account gate, and recovery material protected.
- Do not treat the shared loopback HTTP origin or a healthy container as web-vault acceptance.
