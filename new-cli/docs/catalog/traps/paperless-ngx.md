# Paperless-ngx traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `paperless-ngx-db`, `paperless-ngx-broker`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Network filesystems may require polling; database and archive restore together.

## Security

- Treat document contents as sensitive and control ingest paths.
