# Vector traps

## Pitfalls

- Broad Docker or host log access can collect unintended sensitive content.
- The self-only recipe does not collect host or application logs; a running process or healthy API does not establish real ingestion.

## Security

- Redact credentials and personal data before routing telemetry.
- The unauthenticated observability API must remain on loopback or another private trusted network when enabled.
