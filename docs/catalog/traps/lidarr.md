# Lidarr traps

## Pitfalls

- Path mismatches and music metadata availability can prevent reliable imports.
- The pinned Lidarr API uses /api/v1, unlike the Sonarr/Radarr /api/v3 route. The candidate shared adapter configures Forms login only; music root, downloader wiring, and restart persistence still need direct acceptance.

## Security

- Treat API keys as secrets and keep management access private.
