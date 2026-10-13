# Lidarr traps

## Pitfalls

- Path mismatches and music metadata availability can prevent reliable imports.
- The pinned Lidarr API uses /api/v1, unlike the Sonarr/Radarr /api/v3 route. The candidate shared adapter configures Forms login only; music root, downloader wiring, and restart persistence still need direct acceptance.
- The Homarr Link checks authenticated Lidarr 3.x API v1, artist monitoring data and the selected calendar source. Its shared Stats callback validates one advancing forced sample: integral nonnegative `artists`, `monitored` and `upcoming` in `count` units, with monitored artists bounded by artists. Native calendar/library observations are independent and are not compared with refreshed Stats. Empty results and nullable calendar subtitles remain valid. Source and focused HTTP fixtures do not establish rendered or lifecycle acceptance.

## Security

- Treat API keys as secrets and keep management access private.
