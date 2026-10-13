# Lidarr traps

## Pitfalls

- Path mismatches and music metadata availability can prevent reliable imports.
- The pinned Lidarr API uses /api/v1, unlike the Sonarr/Radarr /api/v3 route. The candidate shared adapter configures Forms login only; music root, downloader wiring, and restart persistence still need direct acceptance.
- The Homarr Link checks authenticated Lidarr 3.x API v1, artist monitoring data and the selected calendar source. Its shared Stats callback validates one advancing forced sample: integral nonnegative `artists`, `monitored` and `upcoming` in `count` units, with monitored artists bounded by artists. Native calendar/library observations are independent and are not compared with refreshed Stats. Empty results and nullable calendar subtitles remain valid. Source and focused HTTP fixtures do not establish rendered or lifecycle acceptance.

- The Homarr Link probes the App-owned readiness before any Homarr request. Unsupported versions/API contracts and external authentication retain retryable Manual classification and the owner's recovery hint; rejected credentials remain failed Setup. This catches policy drift even when a previous Setup was recorded ready.

## Security

- Treat API keys as secrets and keep management access private.
