# Vaultwarden 1.37.3 setup boundary

Keep the existing standalone CLI signup/closure/recovery route for its saved
owners. The shared recipe now installs the pinned server with owned `/data`
storage, closed signup/invitations, no server admin token, and one generated
mode-0600 master-password file. It does not create a vault account.

`setup.ts` provides the app-owned canonical `DOMAIN` derivation for the approved
same-owner HTTPS transition and verifies pinned `/api/config` identity, URL
fields and effective signup-disabled readback. Omitted `DOMAIN` before that
transition is deliberate: the HTTP backend is not the user-facing vault identity.
Canonical readback never marks this adapter ready or extracts a fabricated API
key. The shared route owner must bind the helper result into its reviewed
manifest and transport; exporting the helper alone is not applied TLS proof.

Required choices: stable canonical HTTPS `DOMAIN`, exact owned private TLS route,
intended-client DNS/trust, first-owner email, and one bounded signup window.
Account creation must use a pinned compatible official Bitwarden client. The
registration model needs KDF settings, authentication hash, and wrapped user key;
the password grant also needs client/device identity and can require challenges.
Neither route is a generic plaintext email/password API. A token or `/api/sync`
read does not prove client-side key decryption or unlock.

The smallest missing interface is a **pinned official-client enrollment/unlock
boundary**: bind executable/version and server origin to the exact owner, transport
password privately, checkpoint enrollment before sending, preserve private client
state outside ordinary output, and verify the exact account plus an authorized
decrypted round-trip. Until this exists, preserve the explicit official web-client
completion gate; do not duplicate cryptographic derivation in an app adapter.

`ADMIN_TOKEN` controls the separate server admin page, not a vault account. Leave
the page disabled unless separately requested. Pinned source supports `NAME_FILE`
and Argon2id PHC admin tokens; bcrypt is not a replacement. A future private admin
token handoff must remain separate from the account master password/key custody.

Registration closure needs the exact owner Compose revision and effective-policy
readback covering whitelist, invitations and persisted `config.json` overrides.
Verify fresh client login/unlock after closure and scoped restart; recovery/export
and isolated restore remain independent gates.

Sources: [pinned account models](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/core/accounts.rs),
[pinned identity routes](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/api/identity.rs),
[pinned file reader](https://github.com/dani-garcia/vaultwarden/blob/1.37.3/src/util.rs),
[admin page](https://github.com/dani-garcia/vaultwarden/wiki/Enabling-admin-page),
[registration policy](https://github.com/dani-garcia/vaultwarden/wiki/Disable-registration-of-new-users).
