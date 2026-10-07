# Bazarr traps

## Pitfalls

- Mount the same selected media root at /data as Sonarr and Radarr; subtitles require write access to media files.
- Compose start alone does not establish login or API access; the shared adapter must verify both against the exact private origin.
- The shared adapter does not configure Sonarr, Radarr, subtitle providers, or download and subtitle-path acceptance.

## Security

- Keep the web UI private; the shared first-run adapter configures Basic authentication, but any wider access needs separate review.
- Store provider and Arr credentials outside catalog and preferences.
