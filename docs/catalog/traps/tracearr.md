# Tracearr traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `tracearr-timescale`, `tracearr-redis`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Session analytics are not a replacement for service readiness or host monitoring.
- The standard image requires TimescaleDB, not plain PostgreSQL, and a secret-bearing DATABASE_URL.
- The current official pg18 Compose example calls PostgreSQL 18 experimental and new-install-only; never reuse an existing data volume with it.
- The bundled local-owner adapter requires a reviewed email, refuses an existing uncheckpointed owner or claim-code setup, and never repeats an uncertain signup or API-key rotation.
- Owner and API-key setup does not enroll a media server, fetch media, configure notifications, or prove Homarr integration or restart persistence.

## Security

- Treat session history, user identities, IP data, and media-server API access as sensitive.
