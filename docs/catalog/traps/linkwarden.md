# Linkwarden traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `linkwarden-postgres`, `linkwarden-meilisearch`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Captured content can create storage growth and legal retention questions.
- Shared setup checkpoints first-owner login and a saved API token before an exact reviewed Compose environment transition. Rerun shared setup after transition for saved-login, token, and anonymous registration-denial readback; a failed denial probe may create an extra account and requires inspection. Archive roundtrip and restart persistence remain separate acceptance checks.

## Security

- Keep the service private, use distinct random NEXTAUTH_SECRET, POSTGRES_PASSWORD, and MEILI_MASTER_KEY values, and protect archived content and access tokens.
- Homarr uses a dedicated 90-day token for the selected Project administrator (canonical account ID 1). Linkwarden v2.16.3 has no read-only token scopes: this credential carries that account's write privileges. A fresh peer preflight checks identity and recorded ownership before Homarr mutation; acceptance additionally checks the saved Homarr integration's account ID through `integration.request` before refreshing native Stats. Empty or equal counts cannot prove identity. Registration and rendered/lifecycle acceptance remain parent-owned holds.
- Homarr verifies `links`, `collections`, and `tags` from one central forced Stats refresh and its catalog. All three must use `count` units and report finite, nonnegative integers; explicit zeros are valid. Token ownership and saved-account identity are verified separately before Stats.
- Restore only a known corresponding token and ownership JSON (`id`, `accountId`, `expires`, `fingerprint`) through optional private inputs `linkwarden.homarr_api_key` and `linkwarden.homarr_token_ownership` using approved `install --set-file` ingestion from owner-only credential files. Empty values preserve saved secrets. Review and preserve existing authentication, mounts and ports and separately approve Compose replacement first; never blindly run `install --yes` or edit raw secret files. Then retry `self-host setup linkwarden` and `self-host setup homarr`.
- Token issuance records pending ownership before saving the credential. A failed credential write or finalization stays unverified; restore its known matching secret to reuse the checkpoint, or explicitly revoke only the recorded token. Setup resets a pending or mismatched pair only after authenticated official inventory confirms both its ID and managed name are absent. An unknown/malformed ownership record or managed-name collision remains Manual. If issuance succeeds before its checkpoint can be saved, the name collision prevents another issuance but cannot reconstruct the lost credential/ID: explicit known-pair restoration or ownership review is still required. This is not an atomic-write guarantee.
