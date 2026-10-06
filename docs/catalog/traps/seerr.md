# Seerr traps

## Pitfalls

- The first-run flow needs owner-selected media-server credentials, libraries, and Sonarr/Radarr endpoints and API keys; use service DNS rather than localhost between containers.
- Back up existing Overseerr/Jellyseerr data before first start because migration is automatic and forward-only.

## Security

- Keep media-server credentials and Sonarr/Radarr API keys in secret storage; scope public access separately.

## From docs/seerr.md

### Traps

- `localhost` and `127.0.0.1` are invalid internal Docker targets.
- Browser Jellyfin sign-in stays disabled until its required Email Address is
  filled. Do not infer a network failure from that disabled button alone.
- Seerr's Radarr/Sonarr browser forms append help text to the API-key label.
  Use `browser-key refs` for the matching service and `browser-key fill` with
  its fresh ref; the private helper recognizes only the exact service-specific
  label on Seerr setup/service pages.
- If automatic search is declined or a safety review rejects the setting,
  leave it off, do not retry through another route, and report the verifier
  gap. A saved server is not proof that requests can initiate acquisition.
- Rootless Docker remaps container UID 1000. The isolated session creator makes
  only Seerr's nested config mount writable while keeping its parent run private.
- Sonarr/Radarr requests fail unless a default server, quality profile, and root
  folder are all selected.
- API setup is safe to resume only when the existing Jellyfin, Radarr, and
  Sonarr identities match the managed topology. It rejects conflicts rather
  than replacing another server.
- The API key grants admin access. Source it from the session file, never copy it
  into Markdown or screenshots.

Sources: [Docker](https://docs.seerr.dev/getting-started/docker/),
[media server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/),
[Sonarr/Radarr services](https://docs.seerr.dev/using-seerr/settings/services/),
[general/API key](https://docs.seerr.dev/using-seerr/settings/general/).
