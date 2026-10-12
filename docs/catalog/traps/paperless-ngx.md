# Paperless-ngx traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `paperless-ngx-db`, `paperless-ngx-broker`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Network filesystems may require polling; database and archive restore together.

## Security

- Treat document contents as sensitive and control ingest paths.
- Setup saves a dedicated Homarr account and reusable API token through the Project's secret boundary. It grants only global document statistics and read access to tags, correspondents and document types, not document contents, uploads, edits or administrator access. Taxonomy counts respect Paperless's object permissions; Setup never changes document or taxonomy ownership.
- Setup checkpoints the returned account ID and a random ownership marker in `PAPERLESS_NGX_HOMARR_ACCOUNT`; the marker also occupies the dedicated account's First name field. Every rerun looks up that exact ID and matches the marker in the authenticated profile before consuming a token. Renames and a lost saved username recover the canonical username without creating another account. Checks authenticate afresh against statistics and all three taxonomy endpoints; stale/missing keys reuse the same verified account's current token without rotation.
- Rejected passwords, disabled accounts, MFA and changed account permissions are retryable Manual steps. A person can use `self-host credentials` privately, then open Paperless's Users & Groups → Edit user, confirm the displayed recorded ID and unchanged First name marker, and restore the same saved password or Active status only if intended. Do not generate a new token, broaden permissions, reset another account or disable MFA merely to pass Setup. Restoring the known pair allows stable-token reuse; retry `self-host setup paperless-ngx`, then `self-host setup homarr`.
- Older username/password/token-only records, missing credentials, uncertain ownership and pending/partial checkpoint writes are preserved as Manual rather than adopted by name or replaced. A verified Project Backup containing the checkpoint/credentials can restore known provenance. No automatic name-only migration or credentials-only update command exists here; another migration/replacement requires separately approved scope. No optional private Inputs or install-based credential ingestion were added.
- These permissions and recovery controls target the pinned Paperless-ngx 3.2.1 API. The Homarr descriptor targets `paperlessNgx` and its native document widget in Homarr 2.4.1. #262's contract is now available, but central registration, native rendering and complete widget lifecycle acceptance remain held. See [the proof and source-only follow-up](../../homarr-paperless-proof.md).
