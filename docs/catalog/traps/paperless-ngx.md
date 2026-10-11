# Paperless-ngx traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `paperless-ngx-db`, `paperless-ngx-broker`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Network filesystems may require polling; database and archive restore together.

## Security

- Treat document contents as sensitive and control ingest paths.
- Setup saves a dedicated Homarr account and reusable API token through the Project's secret boundary. It grants only global document statistics and read access to tags, correspondents and document types, not document contents, uploads, edits or administrator access. Taxonomy counts respect Paperless's object permissions; Setup never changes document or taxonomy ownership.
- Existing Projects acquire this credential with `self-host setup paperless-ngx`. Checks authenticate afresh against the statistics and all three taxonomy endpoints. Missing or revoked tokens are rediscovered from the dedicated account without rotating an existing token. A rejected account password is not reset; repair that account before retrying Setup.
- These permissions target the pinned Paperless-ngx 3.2.1 API. The Homarr descriptor targets `paperlessNgx` and its native document widget in Homarr 2.4.1; registration and complete widget lifecycle acceptance wait for #262's shared compatibility and ownership contract.
